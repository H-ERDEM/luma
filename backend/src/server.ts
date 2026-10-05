import express, { Request, Response } from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { env, limits, maskRpcUrl } from "./config";
import { buildTelemetry, theoreticalCurve } from "./biology";
import { AppContext, BatchStateSnapshot, describeError } from "./context";
import { ipRateLimit, WindowCounter } from "./limits";
import { createSimulatorRouter } from "./simulator";

const walletParam = z.string().refine((v) => {
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}, "Geçerli bir Solana adresi değil");

/** Zincirdeki son ölçüm + aynı gün için simüle edilmiş canlı sensör okuması. */
function telemetryFeed(ctx: AppContext, state: BatchStateSnapshot) {
  const a = ctx.activeBatch();
  const committed = state.telemetry;
  const breach = committed.waterTempCentiC > 3_200 || (committed.flowRateMlMin === 0 && Number(committed.sequence) > 0);
  const liveSeed = Math.floor(Date.now() / 4_000);
  const live = buildTelemetry(committed.day, 0n, BigInt(Math.floor(Date.now() / 1_000)), {
    outage: breach || state.status === "Defaulted",
    jitterSeed: liveSeed,
  });
  return {
    status: state.status,
    committed,
    live: {
      day: live.day,
      growthFactorBps: live.growthFactorBps,
      waterTempCentiC: live.waterTempCentiC,
      flowRateMlMin: live.flowRateMlMin,
      ecMicroSCm: live.ecMicroSCm,
      phCenti: live.phCenti,
      observedAt: live.observedAt.toString(),
    },
    history: ctx.telemetryHistory(a.batchId),
    curve: theoreticalCurve(BigInt(state.unitPrice)),
  };
}

export function createApp(ctx: AppContext) {
  const app = express();
  // Ters vekil (Render vb.) arkasında gerçek istemci IP'si için; 0 iken X-Forwarded-For'a güvenilmez.
  if (limits.trustProxy > 0) app.set("trust proxy", limits.trustProxy);
  app.use(cors({ origin: env.frontendOrigin }));
  app.use(express.json({ limit: "32kb" }));

  const handle =
    (task: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        res.json(await task(req));
      } catch (err) {
        const { status, message, logs, retryAfterSec } = describeError(err);
        if (retryAfterSec !== undefined) res.set("Retry-After", String(retryAfterSec));
        res.status(status).json({ error: message, logs });
      }
    };

  /** Zincirden okunan durum (USDC mint'i, aktif parti, geçmiş) hazır olana kadar API isteklerini bekletir. */
  app.use(async (req, res, next) => {
    if (req.path === "/api/live" || req.path === "/api/health" || req.method === "OPTIONS") return next();
    try {
      await ctx.ensureReady();
      next();
    } catch (err) {
      const { message } = describeError(err);
      res.status(503).json({ error: `Zincir durumu okunamadı, birkaç saniye sonra tekrar deneyin. (${message})` });
    }
  });

  const rateCounter = new WindowCounter();
  const mutationLimit = (scope: string) => ipRateLimit(rateCounter, limits.rateLimitMax, limits.rateLimitWindowSec, scope);

  /** Süreç canlı mı? Hiçbir RPC çağrısı yapmaz; barındırıcının (Render) sağlık kontrolü için. */
  app.get("/api/live", (_req, res) => {
    res.json({ ok: true });
  });

  /** Canlılık + admin SOL durumu: admin eşiğin altındaysa 503 (dışarıdan bir uptime izleyicisi uyarı verebilir). */
  app.get("/api/health", async (_req, res) => {
    const base = { rpc: maskRpcUrl(env.rpcUrl) };
    try {
      const admin = await ctx.adminStatus();
      res.status(admin.low ? 503 : 200).json({ ok: !admin.low, ...base, adminSol: Math.round(admin.sol * 100) / 100, adminLowSol: admin.low });
    } catch {
      // RPC okunamıyor: süreç ayakta, ama admin bakiyesi bilinmiyor.
      res.json({ ok: true, ...base, adminSol: null, adminLowSol: false, rpcOk: false });
    }
  });

  app.get(
    "/api/idl/:name",
    handle(async (req) => {
      const name = z.enum(["luma_batch", "luma_transfer_hook"]).parse(req.params.name);
      return name === "luma_batch" ? ctx.client.batchIdl : ctx.client.hookIdl;
    }),
  );

  const isFresh = (req: Request): boolean => req.query.fresh === "1";

  app.get(
    "/api/batch/state",
    handle(async (req) => ctx.batchState({ fresh: isFresh(req) })),
  );

  /** Canlı IoT akışı: zincire yazılmış son ölçüm + aynı gün için simüle sensör okuması. */
  app.get(
    "/api/telemetry/current",
    handle(async (req) => telemetryFeed(ctx, await ctx.batchState({ fresh: isFresh(req) }))),
  );

  /** Durum ve telemetri tek yanıtta (tek RPC turu); arayüzün yoklaması bunu kullanır. */
  app.get(
    "/api/snapshot",
    handle(async (req) => {
      const state = await ctx.batchState({ fresh: isFresh(req) });
      return { state, feed: telemetryFeed(ctx, state) };
    }),
  );

  app.get(
    "/api/kyc/:wallet",
    handle(async (req) => {
      const wallet = new PublicKey(walletParam.parse(req.params.wallet));
      return ctx.client.kycStatus(wallet);
    }),
  );

  /** Demo KYC sağlayıcısı: test cüzdanını zincir üstü KycRegistry'de onaylar. */
  app.post(
    "/api/kyc/verify",
    mutationLimit("kyc"),
    handle(async (req) => {
      const { wallet } = z.object({ wallet: walletParam }).parse(req.body);
      // Zaten onaylıysa zincire yazma: her yazma admin SOL'u harcar.
      if ((await ctx.client.kycStatus(new PublicKey(wallet))).approved) {
        return { wallet, approved: true, signature: null, alreadyApproved: true };
      }
      const signature = await ctx.mutex.run(() => ctx.client.setKyc(new PublicKey(wallet), true));
      return { wallet, approved: true, signature };
    }),
  );

  app.use("/demo", mutationLimit("demo"), createSimulatorRouter(ctx));
  return app;
}

if (require.main === module) {
  (async () => {
    const ctx = new AppContext(); // anahtarlar eksik/geçersizse burada açık bir hatayla durur
    await ctx.verifyKeys(); // üretimde zincirdeki config ile uyuşmayan anahtarla başlamayı reddeder
    createApp(ctx).listen(env.port, () => {
      console.log(`LUMA backend http://localhost:${env.port} (RPC: ${maskRpcUrl(env.rpcUrl)})`);
    });
    // Zincir durumunu ilk istekten önce ısıt; başarısız olursa ilk istek yeniden dener.
    void ctx.ensureReady().catch((err) => console.warn(`Zincir durumu henüz okunamadı: ${describeError(err).message}`));
  })().catch((err) => {
    console.error(describeError(err).message);
    process.exit(1);
  });
}
