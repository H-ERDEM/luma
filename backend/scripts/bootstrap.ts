/**
 * Tek seferlik kurulum: mock USDC mint'i, ProtocolConfig ve ilk parti (Token-2022 mint + hook
 * ExtraAccountMetaList + escrow/rezerv + rezerv fonlaması + gün 0 telemetrisi).
 */
import { AppContext, describeError } from "../src/context";

async function main(): Promise<void> {
  const ctx = new AppContext();
  const a = await ctx.bootstrap();
  const config = await ctx.client.fetchConfig();
  console.log("Program (luma_batch):     ", ctx.client.batchProgram.programId.toBase58());
  console.log("Program (transfer hook):  ", ctx.client.hookProgram.programId.toBase58());
  console.log("Admin / KYC yetkisi:      ", ctx.client.admin.toBase58());
  console.log("Chainlink DON imzacısı:   ", config.donAuthority.toBase58());
  console.log("Ed25519 fallback imzacısı:", config.fallbackAuthority.toBase58());
  console.log("Mock USDC mint:           ", ctx.usdcMint().toBase58());
  console.log("Aktif parti:              ", a.batchId.toString(), a.batchVault.toBase58());
  console.log("Parti mint'i (Token-2022):", a.mint.toBase58());
}

main().catch((err) => {
  const { message, logs } = describeError(err);
  console.error("Bootstrap başarısız:", message);
  if (logs) console.error(logs.join("\n"));
  process.exit(1);
});
