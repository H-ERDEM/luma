import express, { Request, Response } from "express";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { env, maskRpcUrl } from "./config";
import { buildTelemetry, theoreticalCurve } from "./biology";
import { AppContext, BatchStateSnapshot, describeError } from "./context";
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
    history: ctx.store.history(a.batchId),
    curve: theoreticalCurve(BigInt(state.unitPrice)),
  };
}

export function createApp(ctx: AppContext) {
  const app = express();
  app.use(cors({ origin: env.frontendOrigin }));
  app.use(express.json({ limit: "32kb" }));

  const handle =
    (task: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        res.json(await task(req));
      } catch (err) {
        const { status, message, logs } = describeError(err);
        res.status(status).json({ error: message, logs });
      }
    };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, rpc: maskRpcUrl(env.rpcUrl) });
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
    handle(async (req) => {
      const { wallet } = z.object({ wallet: walletParam }).parse(req.body);
      const signature = await ctx.mutex.run(() => ctx.client.setKyc(new PublicKey(wallet), true));
      return { wallet, approved: true, signature };
    }),
  );

  app.use("/demo", createSimulatorRouter(ctx));
  return app;
}

if (require.main === module) {
  const ctx = new AppContext();
  createApp(ctx).listen(env.port, () => {
    console.log(`LUMA backend http://localhost:${env.port} (RPC: ${maskRpcUrl(env.rpcUrl)})`);
  });
}
