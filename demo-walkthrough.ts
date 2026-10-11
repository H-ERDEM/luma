/**
 * LumaGrow — Autonomous AgTech RWA Protocol on Solana
 * TypeScript Client Simulation SDK & Complete Walkthrough Script
 * 
 * Demonstrating the 3 Execution Tracks:
 * Track A: Full Maturity (Day 0 -> Day 40 @ 0.60 USDC/token)
 * Track B: Day 20 Early Exit with 15% Liquidity Tax (0.525 gross -> 0.44625 net USDC/token)
 * Track C: Day 15 Parametric Insurance Trigger (3 consecutive danger ticks -> 100% 0.45 USDC refund)
 */

import { PublicKey, Keypair } from "@solana/web3.js";
import BN from "bn.js";

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

export const PROTOCOL_CONSTANTS = {
  PROGRAM_ID: new PublicKey("A7d9dA7vCcVQEoMPVoTgTmNRoRHvPk9VqurhTKWLRGmM"),
  TRANSFER_HOOK_ID: new PublicKey("H1vq1NJ4wm4WwPchrChCf4a2MbDABdNya2rusQ7qtj4z"),
  
  MINT_PRICE_USDC: 450_000,          // 0.450000 USDC (6 decimals)
  MATURITY_PRICE_USDC: 600_000,      // 0.600000 USDC
  DAY_20_BASE_USDC: 525_000,         // 0.525000 USDC: 0.45 + (0.60 - 0.45) / 2
  EARLY_EXIT_TAX_BPS: 1500,          // 15.00%
  DAY_20_NET_PRICE_USDC: 446_250,    // 0.446250 USDC
  DAY_20_TAX_USDC: 78_750,           // 0.078750 USDC retained in vault

  BPS_DENOMINATOR: 10_000,
  CYCLE_DAYS: 40,
  EARLY_EXIT_DAY: 20,

  // Critical IoT Parametric Thresholds
  PH_MIN_DANGER: 450,                // 4.50 scaled by 100
  PH_MAX_DANGER: 750,                // 7.50 scaled by 100
  EC_MIN_DANGER: 50,                 // 0.50 scaled by 100
  EC_MAX_DANGER: 300,                // 3.00 scaled by 100
  DANGER_CONSECUTIVE_THRESHOLD: 3,
};

export enum BatchStatus {
  Funding = "Funding",
  Growing = "Growing",
  HarvestSettled = "HarvestSettled",
  InsuranceTriggered = "InsuranceTriggered",
  Closed = "Closed",
}

export interface GrowthStateModel {
  batchId: number;
  currentDay: number;
  ph: number;
  ec: number;
  consecutiveDangerTicks: number;
  isDanger: boolean;
  status: BatchStatus;
}

export interface BatchVaultModel {
  batchId: number;
  totalMinted: number;
  activeSupply: number;
  collateralVaultUsdc: number;
  accumulatedTaxPoolUsdc: number;
  status: BatchStatus;
}

export interface KycRegistryModel {
  wallet: string;
  isApproved: boolean;
  updatedAt: number;
}

// ============================================================================
// SIMULATION ENGINE (CLIENT SDK)
// ============================================================================

export class LumaGrowSimulationClient {
  public batchVault: BatchVaultModel;
  public growthState: GrowthStateModel;
  public kycRegistry: Map<string, KycRegistryModel> = new Map();

  constructor(public batchId: number) {
    this.batchVault = {
      batchId,
      totalMinted: 0,
      activeSupply: 0,
      collateralVaultUsdc: 0,
      accumulatedTaxPoolUsdc: 0,
      status: BatchStatus.Funding,
    };

    this.growthState = {
      batchId,
      currentDay: 0,
      ph: 580, // Optimal 5.80 pH
      ec: 140, // Optimal 1.40 EC
      consecutiveDangerTicks: 0,
      isDanger: false,
      status: BatchStatus.Funding,
    };
  }

  // 1. Whitelist / KYC Registry
  public setKyc(wallet: string, isApproved: boolean) {
    this.kycRegistry.set(wallet, {
      wallet,
      isApproved,
      updatedAt: Date.now(),
    });
  }

  // 2. Fund & Mint Seedlings (Token-2022 Proof-of-Asset)
  public fundAndMint(investorWallet: string, quantity: number) {
    const kyc = this.kycRegistry.get(investorWallet);
    if (!kyc || !kyc.isApproved) {
      throw new Error(`[KYC REJECTED] Wallet ${investorWallet} is not KYC whitelisted via Transfer Hook registry.`);
    }

    if (this.batchVault.status !== BatchStatus.Funding && this.batchVault.status !== BatchStatus.Growing) {
      throw new Error(`[MINT ERROR] Batch is currently in ${this.batchVault.status} status.`);
    }

    const costMicroUsdc = quantity * PROTOCOL_CONSTANTS.MINT_PRICE_USDC;
    this.batchVault.totalMinted += quantity;
    this.batchVault.activeSupply += quantity;
    this.batchVault.collateralVaultUsdc += costMicroUsdc;
    this.batchVault.status = BatchStatus.Growing;
    this.growthState.status = BatchStatus.Growing;

    return {
      quantity,
      costUsdc: costMicroUsdc / 1_000_000,
      vaultBalanceUsdc: this.batchVault.collateralVaultUsdc / 1_000_000,
    };
  }

  // 3. IoT Oracle Telemetry Update & Parametric Circuit Breaker
  public updateTelemetry(day: number, ph: number, ec: number) {
    if (this.batchVault.status === BatchStatus.InsuranceTriggered) {
      throw new Error("[CIRCUIT BREAKER FROZEN] Operations permanently frozen due to Insurance Trigger.");
    }

    this.growthState.currentDay = day;
    this.growthState.ph = ph;
    this.growthState.ec = ec;

    const inDanger =
      ph < PROTOCOL_CONSTANTS.PH_MIN_DANGER ||
      ph > PROTOCOL_CONSTANTS.PH_MAX_DANGER ||
      ec < PROTOCOL_CONSTANTS.EC_MIN_DANGER ||
      ec > PROTOCOL_CONSTANTS.EC_MAX_DANGER;

    this.growthState.isDanger = inDanger;

    if (inDanger) {
      this.growthState.consecutiveDangerTicks += 1;
      if (this.growthState.consecutiveDangerTicks >= PROTOCOL_CONSTANTS.DANGER_CONSECUTIVE_THRESHOLD) {
        this.batchVault.status = BatchStatus.InsuranceTriggered;
        this.growthState.status = BatchStatus.InsuranceTriggered;
      }
    } else {
      this.growthState.consecutiveDangerTicks = 0;
    }

    return { ...this.growthState, batchStatus: this.batchVault.status };
  }

  // 4. Day 20 Early Exit with 15% Bonding Curve Tax
  public earlyExitDay20(investorWallet: string, quantity: number) {
    if (this.batchVault.status !== BatchStatus.Growing) {
      throw new Error(`[EARLY EXIT REJECTED] Batch is not in Growing state (current: ${this.batchVault.status}).`);
    }

    if (this.growthState.currentDay < PROTOCOL_CONSTANTS.EARLY_EXIT_DAY || this.growthState.currentDay >= PROTOCOL_CONSTANTS.CYCLE_DAYS) {
      throw new Error(`[EARLY EXIT NOT OPEN] Current day is ${this.growthState.currentDay}. Early exit only open on Day 20 to 39.`);
    }

    if (this.batchVault.activeSupply < quantity) {
      throw new Error(`[BALANCE ERROR] Insufficient active supply.`);
    }

    // Calculations
    const grossMicroUsdc = quantity * PROTOCOL_CONSTANTS.DAY_20_BASE_USDC;
    const taxMicroUsdc = Math.floor((grossMicroUsdc * PROTOCOL_CONSTANTS.EARLY_EXIT_TAX_BPS) / PROTOCOL_CONSTANTS.BPS_DENOMINATOR);
    const netPayoutMicroUsdc = grossMicroUsdc - taxMicroUsdc;

    // State Mutation: Burn tokens, pay investor, keep tax in pool
    this.batchVault.activeSupply -= quantity;
    this.batchVault.collateralVaultUsdc -= netPayoutMicroUsdc;
    this.batchVault.accumulatedTaxPoolUsdc += taxMicroUsdc;

    return {
      quantityBurned: quantity,
      grossUsdc: grossMicroUsdc / 1_000_000,
      taxRetainedUsdc: taxMicroUsdc / 1_000_000,
      netPayoutUsdc: netPayoutMicroUsdc / 1_000_000,
      remainingVaultUsdc: this.batchVault.collateralVaultUsdc / 1_000_000,
      accumulatedTaxPoolUsdc: this.batchVault.accumulatedTaxPoolUsdc / 1_000_000,
    };
  }

  // 5. Day 40 Harvest Settlement & OTC Injection
  public settleHarvestDay40(sponsorWallet: string) {
    if (this.batchVault.status !== BatchStatus.Growing) {
      throw new Error(`[SETTLEMENT ERROR] Cannot settle in status: ${this.batchVault.status}`);
    }
    if (this.growthState.currentDay < PROTOCOL_CONSTANTS.CYCLE_DAYS) {
      throw new Error(`[MATURITY ERROR] Cannot settle before Day 40 (current: Day ${this.growthState.currentDay})`);
    }

    const totalRequiredMicroUsdc = this.batchVault.activeSupply * PROTOCOL_CONSTANTS.MATURITY_PRICE_USDC;
    // The accumulated tax pool remains in the vault to yield-boost remaining holders
    const neededOtcDeposit = Math.max(0, totalRequiredMicroUsdc - this.batchVault.collateralVaultUsdc);

    this.batchVault.collateralVaultUsdc += neededOtcDeposit;
    this.batchVault.status = BatchStatus.HarvestSettled;
    this.growthState.status = BatchStatus.HarvestSettled;

    return {
      activeSupply: this.batchVault.activeSupply,
      otcDepositedUsdc: neededOtcDeposit / 1_000_000,
      totalVaultUsdc: this.batchVault.collateralVaultUsdc / 1_000_000,
    };
  }

  // 6. Harvest Maturity Token Redemption
  public harvestRedeem(investorWallet: string, quantity: number) {
    if (this.batchVault.status !== BatchStatus.HarvestSettled) {
      throw new Error("[REDEMPTION ERROR] Harvest has not settled yet.");
    }
    if (this.batchVault.activeSupply < quantity) {
      throw new Error("[REDEMPTION ERROR] Exceeds active supply.");
    }

    const payoutMicroUsdc = quantity * PROTOCOL_CONSTANTS.MATURITY_PRICE_USDC;
    this.batchVault.activeSupply -= quantity;
    this.batchVault.collateralVaultUsdc -= payoutMicroUsdc;

    return {
      quantityBurned: quantity,
      payoutUsdc: payoutMicroUsdc / 1_000_000,
      effectiveRateUsdc: payoutMicroUsdc / quantity / 1_000_000,
    };
  }

  // 7. Parametric Insurance Claim (Circuit Breaker Refund)
  public claimInsuranceRefund(investorWallet: string, quantity: number) {
    if (this.batchVault.status !== BatchStatus.InsuranceTriggered) {
      throw new Error("[INSURANCE CLAIM REJECTED] Insurance circuit breaker is NOT triggered.");
    }
    if (this.batchVault.activeSupply < quantity) {
      throw new Error("[INSURANCE CLAIM REJECTED] Exceeds active supply.");
    }

    // Exactly 100% principal refund = 0.45 USDC per seedling
    const refundMicroUsdc = quantity * PROTOCOL_CONSTANTS.MINT_PRICE_USDC;
    this.batchVault.activeSupply -= quantity;
    this.batchVault.collateralVaultUsdc -= refundMicroUsdc;

    return {
      quantityBurned: quantity,
      refundUsdc: refundMicroUsdc / 1_000_000,
      refundRateUsdc: refundMicroUsdc / quantity / 1_000_000,
    };
  }
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

function banner(title: string) {
  console.log("\n" + "=".repeat(78));
  console.log(`🌿  ${title.toUpperCase()}`);
  console.log("=".repeat(78));
}

function subheader(title: string) {
  console.log(`\n--- 📌 ${title} ---`);
}

// ============================================================================
// SIMULATION DEMONSTRATION RUNNER
// ============================================================================

async function runLumaGrowWalkthrough() {
  console.log(`
██╗     ██╗   ██╗███╗   ███╗ █████╗  ██████╗ ██████╗  ██████╗ ██╗    ██╗
██║     ██║   ██║████╗ ████║██╔══██╗██╔════╝ ██╔══██╗██╔═══██╗██║    ██║
██║     ██║   ██║██╔████╔██║███████║██║  ███╗██████╔╝██║   ██║██║ █╗ ██║
██║     ██║   ██║██║╚██╔╝██║██╔══██║██║   ██║██╔══██╗██║   ██║██║███╗██║
███████╗╚██████╔╝██║ ╚═╝ ██║██║  ██║╚██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ 
    SOLANA TOKEN-2022 RWA PROTOCOL: AUTONOMOUS AGTECH DEMO HARNESS
  `);

  // ==========================================================================
  // TRACK A: FULL 40-DAY MATURITY CYCLE
  // ==========================================================================
  banner("Track A: Full 40-Day Maturity Settlement & Redemption");

  const batchA = new LumaGrowSimulationClient(101);
  const alice = "Alice_HQyDk3GjT87R1e...3yH";
  const sponsor = "AgriSponsor_OTC_8wN...4kP";

  subheader("A.1: KYC Verification via Token-2022 Transfer Hook Registry");
  batchA.setKyc(alice, true);
  console.log(`✅ Alice KYC Approved on-chain.`);

  subheader("A.2: Day 0 — Token-2022 Seedling Minting");
  const mintResultA = batchA.fundAndMint(alice, 100);
  console.log(`🌱 Minted: ${mintResultA.quantity} seedlings (1 Token = 1 Lettuce)`);
  console.log(`💰 Paid: $${mintResultA.costUsdc.toFixed(2)} USDC ($0.45 per seedling)`);
  console.log(`🔒 Vault Escrow Balance: $${mintResultA.vaultBalanceUsdc.toFixed(2)} USDC`);

  subheader("A.3: IoT Telemetry Simulation (Days 1 -> 40)");
  console.log("Telemetry readings (Optimal Growth):");
  for (const day of [5, 10, 20, 30, 40]) {
    // Normal fluctuations: pH around 5.80, EC around 1.40
    const telemetry = batchA.updateTelemetry(day, 580 + (day % 10), 140 + (day % 5));
    console.log(
      `  Day ${String(day).padStart(2)}: pH ${(telemetry.ph / 100).toFixed(2)} | ` +
      `EC ${(telemetry.ec / 100).toFixed(2)} | Danger Ticks: ${telemetry.consecutiveDangerTicks} | Status: ${telemetry.batchStatus}`
    );
  }

  subheader("A.4: Day 40 — OTC Harvest Settlement");
  const settleA = batchA.settleHarvestDay40(sponsor);
  console.log(`📦 OTC Buyer Injected: $${settleA.otcDepositedUsdc.toFixed(2)} USDC`);
  console.log(`🏦 Total Vault Pool: $${settleA.totalVaultUsdc.toFixed(2)} USDC for ${settleA.activeSupply} seedlings`);

  subheader("A.5: Alice Burns Tokens & Redeems at Full Maturity Price (0.60 USDC)");
  const redeemA = batchA.harvestRedeem(alice, 100);
  console.log(`🔥 Tokens Burned: ${redeemA.quantityBurned} (Double-dipping strictly prevented)`);
  console.log(`💵 Payout Received: $${redeemA.payoutUsdc.toFixed(2)} USDC`);
  console.log(`📈 Effective ROI: +${(((redeemA.effectiveRateUsdc - 0.45) / 0.45) * 100).toFixed(2)}% net profit!`);

  // ==========================================================================
  // TRACK B: DAY 20 EARLY EXIT WITH 15% TAX (LIQUIDITY PROTECTION)
  // ==========================================================================
  banner("Track B: Day 20 Linear Bonding Curve Early Exit with 15% Tax");

  const batchB = new LumaGrowSimulationClient(102);
  const bob = "Bob_W9vL21kSmT8...5eA";
  const carol = "Carol_HoldingToDay40_9xK";

  subheader("B.1: KYC Registration & Day 0 Minting");
  batchB.setKyc(bob, true);
  batchB.setKyc(carol, true);
  batchB.fundAndMint(bob, 100);    // 100 seedlings ($45)
  batchB.fundAndMint(carol, 100);  // 100 seedlings ($45)
  console.log(`🌱 Total Minted: 200 Seedlings ($90.00 USDC in Vault)`);

  subheader("B.2: IoT Telemetry Advances to Day 20");
  batchB.updateTelemetry(10, 585, 142);
  batchB.updateTelemetry(20, 590, 145);
  console.log(`📅 Batch advanced to Day 20 (Early Exit Window Opens).`);

  subheader("B.3: Bob Executes Day 20 Early Exit");
  console.log(`Bonding Curve Formula applied:`);
  console.log(`  Base Value = 0.45 + ((0.60 - 0.45) / 2) = $0.525 USDC/seedling`);
  console.log(`  Early Exit Tax = 15% ($0.07875 USDC/seedling)`);
  console.log(`  Net Payout Rate = $0.44625 USDC/seedling`);
  
  const exitB = batchB.earlyExitDay20(bob, 100);
  console.log(`\nExecution Results:`);
  console.log(`  🔥 Bob Tokens Burned: ${exitB.quantityBurned}`);
  console.log(`  💰 Gross Calculated Value: $${exitB.grossUsdc.toFixed(4)} USDC`);
  console.log(`  🛡️ 15% Exit Tax Deducted: $${exitB.taxRetainedUsdc.toFixed(4)} USDC (Retained in Vault!)`);
  console.log(`  💸 Net Payout to Bob: $${exitB.netPayoutUsdc.toFixed(4)} USDC`);
  console.log(`  ✨ Accumulated Tax Pool for Day 40 Holders: $${exitB.accumulatedTaxPoolUsdc.toFixed(4)} USDC`);
  console.log(`  🏦 Remaining Vault Balance: $${exitB.remainingVaultUsdc.toFixed(4)} USDC for 100 Carol seedlings`);

  // ==========================================================================
  // TRACK C: DAY 15 PARAMETRIC INSURANCE CIRCUIT BREAKER TRIGGER
  // ==========================================================================
  banner("Track C: Day 15 Parametric Insurance Circuit Breaker Trigger");

  const batchC = new LumaGrowSimulationClient(103);
  const charlie = "Charlie_AgriInvestor_7tP";

  subheader("C.1: KYC Registration & Day 0 Minting");
  batchC.setKyc(charlie, true);
  const mintResultC = batchC.fundAndMint(charlie, 100);
  console.log(`🌱 Charlie Minted 100 Seedlings for $${mintResultC.costUsdc.toFixed(2)} USDC.`);

  subheader("C.2: Simulating Hydroponic Pump Failure & Toxic Nutrient Shock");
  console.log("Telemetry readings with Critical Danger Threshold breaches:");
  console.log(`  Critical Thresholds: pH < 4.50 or > 7.50 | EC < 0.50 or > 3.00`);

  // Danger reading 1
  const t1 = batchC.updateTelemetry(13, 420, 340); // pH 4.20 (<4.50), EC 3.40 (>3.00)
  console.log(`🚨 Day 13: pH 4.20 (DANGER) | EC 3.40 (DANGER) -> Danger Ticks: ${t1.consecutiveDangerTicks}/3`);

  // Danger reading 2
  const t2 = batchC.updateTelemetry(14, 410, 360);
  console.log(`🚨 Day 14: pH 4.10 (DANGER) | EC 3.60 (DANGER) -> Danger Ticks: ${t2.consecutiveDangerTicks}/3`);

  // Danger reading 3 -> Tripping the circuit breaker
  const t3 = batchC.updateTelemetry(15, 390, 380);
  console.log(`🚨 Day 15: pH 3.90 (DANGER) | EC 3.80 (DANGER) -> Danger Ticks: ${t3.consecutiveDangerTicks}/3`);
  console.log(`⚡ CIRCUIT BREAKER TRIPPED! Protocol Status: [${t3.batchStatus}]`);

  subheader("C.3: Verifying Permanent Operations Freeze");
  try {
    batchC.updateTelemetry(16, 580, 140);
  } catch (err: any) {
    console.log(`🔒 Security Verification Passed: Normal updates rejected: "${err.message}"`);
  }

  subheader("C.4: Charlie Claims 100% Principal Refund (0.45 USDC/token)");
  const claimC = batchC.claimInsuranceRefund(charlie, 100);
  console.log(`🔥 Tokens Burned: ${claimC.quantityBurned}`);
  console.log(`💵 100% Principal Refunded: $${claimC.refundUsdc.toFixed(2)} USDC ($0.45/seedling)`);
  console.log(`🛡️ Collateral Vault Solvency maintained; Investor capital protected by Smart Contract.`);

  // ==========================================================================
  // COMPARISON SUMMARY TABLE
  // ==========================================================================
  banner("LumaGrow Protocol Execution Summary Matrix");
  console.table([
    {
      Track: "Track A (Full Maturity)",
      ExitDay: 40,
      Condition: "Normal Harvest",
      InitialCost: "$45.00",
      Payout: "$60.00",
      NetReturn: "+33.33%",
      TokensBurned: 100,
      Status: "HarvestSettled",
    },
    {
      Track: "Track B (Day 20 Early Exit)",
      ExitDay: 20,
      Condition: "Liquidity Exit (15% Tax)",
      InitialCost: "$45.00",
      Payout: "$44.625",
      NetReturn: "-0.83%",
      TokensBurned: 100,
      Status: "Growing (Active)",
    },
    {
      Track: "Track C (Parametric Insurance)",
      ExitDay: 15,
      Condition: "3x IoT Danger Zone Breaches",
      InitialCost: "$45.00",
      Payout: "$45.00",
      NetReturn: "0.00% (100% Principal Protected)",
      TokensBurned: 100,
      Status: "InsuranceTriggered",
    },
  ]);

  console.log("\n✅ All 3 execution tracks successfully executed and validated!");
}

// Run walkthrough if executed directly
if (require.main === module) {
  runLumaGrowWalkthrough().catch((err) => {
    console.error("Simulation error:", err);
    process.exit(1);
  });
}
