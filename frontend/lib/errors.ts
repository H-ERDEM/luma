/**
 * Programların hata mesajları Türkçedir ve zincirdeki sözleşmeler değiştirilemez; bu yüzden
 * Anchor hata KODU (ör. KycNotApproved) arayüzde İngilizce metne çevrilir.
 */
export const PROGRAM_ERRORS: Record<string, string> = {
  KycNotApproved: "Your wallet is not approved in the KYC registry. Use \"Get test funds\" first.",
  Unauthorized: "You are not authorized to do this.",
  UnauthorizedOracle: "The oracle update was not signed by an authorized signer.",
  InvalidEd25519Instruction: "The preceding instruction is not a valid Ed25519 verification.",
  Ed25519AuthorityMismatch: "The Ed25519 signer is not the configured fallback authority.",
  Ed25519MessageMismatch: "The signed message does not match the telemetry payload.",
  StaleSequence: "The telemetry sequence number must be greater than the last record.",
  StaleTelemetry: "The telemetry is too old.",
  TelemetryFromFuture: "The telemetry timestamp is ahead of the chain clock.",
  InvalidDay: "The growth day cannot go backwards or pass the harvest day.",
  InvalidGrowthFactor: "The growth factor must be between 0 and 10,000 bps.",
  InvalidTelemetryValue: "A sensor value is outside its physical range.",
  InsufficientEscrowLiquidity: "The escrow vault does not hold enough USDC.",
  InsufficientExitLiquidity: "The early-exit reserve is too low to pay this exit.",
  SolvencyInvariantViolated: "Solvency check failed: escrow would fall below circulating seedlings × the 0.45 USDC principal.",
  BatchNotActive: "This batch is not active.",
  BatchNotDefaulted: "This batch has not been refunded by the insurance trigger.",
  BatchNotSettled: "The harvest has not been settled yet.",
  FundingClosed: "The funding window is closed. Start a new batch to back a harvest.",
  EarlyExitNotOpen: "Early exit is not open yet (it opens on day 20).",
  EarlyExitClosed: "Harvest day has arrived; redeem instead of exiting early.",
  HarvestNotReached: "Harvest day has not been reached yet.",
  NoDefaultCondition: "The latest telemetry shows no critical failure.",
  CriticalFailurePending: "The latest telemetry reports a critical failure; trigger the insurance first.",
  NoTelemetry: "No telemetry has been recorded yet.",
  MaxSupplyExceeded: "The batch's maximum supply would be exceeded.",
  ZeroAmount: "The amount must be greater than zero.",
  SlippageExceeded: "The price moved below your minimum payout. Try again.",
  MathOverflow: "Arithmetic overflow.",
  InvalidBatchParams: "Invalid batch parameters.",
  InvalidAuthority: "Invalid authority key.",
  SourceNotKycApproved: "The sending wallet is not approved in the KYC registry.",
  DestinationNotKycApproved: "The receiving wallet is not approved in the KYC registry.",
  NotTransferring: "The transfer hook can only run during a Token-2022 transfer.",
};

/** Anchor hata nesnesinden (varsa) kodu okur. */
export function programErrorCode(err: unknown): string | null {
  const e = err as { error?: { errorCode?: { code?: string } } };
  return e.error?.errorCode?.code ?? null;
}
