/**
 * Zaman makinesi ve acil durum API'si (/demo/*). Jüri sunumunda 40 günlük biyolojik süreci
 * saniyelere sıkıştırır. Tüm işlemler gerçek zincir üstü talimatlarla yürütülür.
 */
import { Router, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { BATCH_ECONOMICS, DEMO, limits } from "./config";
import { CROP } from "./biology";
import { AppContext, HttpError, describeError } from "./context";
import { requireDemoToken } from "./limits";

const advanceSchema = z.object({
  targetDay: z.number().int().min(1).max(BATCH_ECONOMICS.harvestDay),
});
const walletSchema = z.object({
  wallet: z.string().refine((v) => {
    try {
      return PublicKey.isOnCurve(new PublicKey(v).toBytes());
    } catch {
      return false;
    }
  }, "Not a valid Solana wallet address"),
});

export function createSimulatorRouter(ctx: AppContext): Router {
  const router = Router();

  const handle =
    (task: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        res.json(await ctx.mutex.run(() => task(req)));
      } catch (err) {
        const { status, message, logs, retryAfterSec } = describeError(err);
        if (retryAfterSec !== undefined) res.set("Retry-After", String(retryAfterSec));
        res.status(status).json({ error: message, logs });
      } finally {
        // Bu uç noktalar zinciri değiştirir (başarısız olsa bile kısmen yazmış olabilir).
        ctx.invalidateState();
      }
    };

  router.post(
    "/advance-days",
    handle(async (req) => {
      const { targetDay } = advanceSchema.parse(req.body);
      const pushed = await ctx.advanceTo(targetDay);
      return { pushed };
    }),
  );

  router.post(
    "/trigger-outage",
    handle(async () => {
      const a = ctx.activeBatch();
      const { day } = await ctx.requireActiveStatus(a);
      const snapshot = await ctx.pushDay(a, day, "ed25519", true);
      const signature = await ctx.client.triggerDefault(a);
      const batch = await ctx.client.fetchBatch(a);
      return { snapshot, signature, refundPrice: batch.refundPrice.toString() };
    }),
  );

  router.post(
    "/settle-harvest",
    handle(async () => {
      const a = ctx.activeBatch();
      const { day } = await ctx.requireActiveStatus(a);
      const pushed = day < BATCH_ECONOMICS.harvestDay ? await ctx.advanceTo(BATCH_ECONOMICS.harvestDay) : [];
      const batch = await ctx.client.fetchBatch(a);
      const circulating = BigInt(batch.totalMinted.toString()) - BigInt(batch.totalBurned.toString());
      // OTC alıcısı hasadı piyasa fiyatından satın alır: dolaşım × Q_est × P_market.
      const otcAmount = (circulating * BigInt(CROP.estYieldGrams) * CROP.marketPricePerKg) / 1_000n;
      const signature = await ctx.client.settleHarvest(a, ctx.usdcMint(), otcAmount);
      const settled = await ctx.client.fetchBatch(a);
      return {
        pushed,
        signature,
        otcAmount: otcAmount.toString(),
        redemptionPrice: settled.redemptionPrice.toString(),
      };
    }),
  );

  router.post(
    "/faucet",
    handle(async (req) => {
      const { wallet } = walletSchema.parse(req.body);
      const owner = new PublicKey(wallet);
      const usdcMint = ctx.usdcMint();

      // Admin bakiyesi çok düşükse faucet tamamen durur (işlem ücretlerini karşılayamaz).
      const admin = await ctx.adminStatus({ fresh: true });
      if (admin.critical) throw new HttpError(503, "The test faucet is closed right now: the admin wallet is low on SOL.");

      // USDC: cüzdanın zincirdeki bakiyesini üst sınıra tamamlar; sınırdaysa hiçbir şey basmaz.
      const balance = await ctx.client.usdcBalance(owner, usdcMint);
      const cap = limits.faucetUsdcCap;
      const toMint = balance >= cap ? 0n : cap - balance;
      const rollbackUsdc = toMint > 0n ? ctx.faucetGuard.reserveUsdc(wallet, toMint) : () => undefined;

      try {
        // SOL: yalnızca eksik kısım ve yalnızca admin bakiyesi eşiğin üstündeyse.
        let solSignature: string | null = null;
        let solSkipped = false;
        const missing = Math.max(0, DEMO.faucetMinLamports - (await ctx.client.lamportsOf(owner)));
        if (missing > 0) {
          if (admin.low) {
            solSkipped = true;
          } else {
            ctx.faucetGuard.reserveSol(missing);
            solSignature = await ctx.client.topUpSol(owner, DEMO.faucetMinLamports);
          }
        }

        const usdcAccount =
          toMint > 0n
            ? await ctx.client.mintUsdc(owner, usdcMint, toMint)
            : ctx.client.usdcAtaAddress(owner, usdcMint);
        return {
          usdcAccount: usdcAccount.toBase58(),
          minted: toMint.toString(),
          balance: (balance + toMint).toString(),
          cap: cap.toString(),
          solSignature,
          solSkipped,
        };
      } catch (err) {
        rollbackUsdc();
        throw err;
      }
    }),
  );

  // Tüm sistemi etkileyen tek işlem: DEMO_RESET_TOKEN doluysa x-demo-token gerektirir.
  router.post(
    "/reset",
    requireDemoToken(limits.demoResetToken, "A judge access key is required to start a new batch."),
    handle(async () => {
      const a = await ctx.startNewBatch();
      return { batchId: a.batchId.toString(), batchVault: a.batchVault.toBase58(), mint: a.mint.toBase58() };
    }),
  );

  router.use((_req, res) => {
    const err = new HttpError(404, "Unknown demo endpoint");
    res.status(err.status).json({ error: err.message });
  });

  return router;
}
