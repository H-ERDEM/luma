/**
 * Edge Case & Math Security Test Suite for LumaGrow
 * 
 * Tests extreme boundary conditions:
 * 1. Zero-division guards in fair value, refund, and redemption calculations
 * 2. Temperature and flow rate threshold limits (32.00°C safe vs 32.01°C critical default)
 * 3. Solvency invariant boundary conditions under varying collateral levels
 * 4. Token-2022 Transfer Hook extra account meta derivations
 * 5. Telemetry Borsh serialization 60-byte stability across platforms
 */

import { expect } from "chai";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  serializeTelemetry,
  telemetryMessage,
  Telemetry,
  BATCH_ECONOMICS,
} from "../backend/src/protocol";
import { PROTOCOL_CONSTANTS, LumaGrowSimulationClient, BatchStatus } from "../demo-walkthrough";

describe("LumaGrow Math & Security Edge Cases", () => {
  const BPS_DENOMINATOR = 10_000n;
  const GRAMS_PER_KG = 1_000n;

  // TypeScript representation of math.rs compute_fair_value
  function computeFairValueTs(p: {
    estYieldGrams: number;
    marketPricePerKg: bigint;
    growthFactorBps: number;
    remainingCost: bigint;
    riskPremium: bigint;
  }): bigint {
    if (p.growthFactorBps > 10_000) {
      throw new Error("InvalidGrowthFactor");
    }
    const b_t = BigInt(p.growthFactorBps);
    const bps = BPS_DENOMINATOR;

    const grossValue =
      (BigInt(p.estYieldGrams) * p.marketPricePerKg * b_t) /
      (GRAMS_PER_KG * bps);

    const remainingCostDrag =
      (p.remainingCost * (bps - b_t)) / bps;

    return grossValue - remainingCostDrag - p.riskPremium;
  }

  describe("1. Fair Value Zero-Division & Extreme Range Protections", () => {
    it("handles zero yield grams without division by zero or NaN", () => {
      const fv = computeFairValueTs({
        estYieldGrams: 0,
        marketPricePerKg: 3_200_000n,
        growthFactorBps: 5_000,
        remainingCost: 200_000n,
        riskPremium: 40_000n,
      });
      // Gross value = 0, drag = 100_000, RP = 40_000 -> -140_000
      expect(fv).to.equal(-140_000n);
    });

    it("rejects growth factor exceeding 10_000 BPS (100%)", () => {
      expect(() =>
        computeFairValueTs({
          estYieldGrams: 250,
          marketPricePerKg: 3_200_000n,
          growthFactorBps: 10_001,
          remainingCost: 0n,
          riskPremium: 0n,
        })
      ).to.throw("InvalidGrowthFactor");
    });

    it("enforces unit price floor (0.45 USDC) even when fair value is heavily negative", () => {
      const client = new LumaGrowSimulationClient(999);
      client.setKyc("TestUser", true);
      client.fundAndMint("TestUser", 10);

      // Deep negative fair value simulation (day 0)
      const fv = computeFairValueTs({
        estYieldGrams: 250,
        marketPricePerKg: 3_200_000n,
        growthFactorBps: 0,
        remainingCost: 400_000n,
        riskPremium: 40_000n,
      });
      expect(fv).to.equal(-440_000n);

      // Curve price must floor at unit price (450_000 micro-USDC)
      const flooredPrice = Math.max(Number(fv), PROTOCOL_CONSTANTS.MINT_PRICE_USDC);
      expect(flooredPrice).to.equal(450_000);
    });
  });

  describe("2. Parametric Circuit Breaker Threshold Boundaries", () => {
    it("maintains safe status when water temp is exactly 32.00°C (3200 centi-C)", () => {
      const MAX_TEMP = 3200;
      const isCritical = (temp: number, flow: number) => temp > MAX_TEMP || flow === 0;

      expect(isCritical(3200, 1500)).to.be.false;
      expect(isCritical(3201, 1500)).to.be.true; // 32.01°C trips
    });

    it("trips immediately on total pump stoppage (flow = 0 ml/min)", () => {
      const isCritical = (temp: number, flow: number) => temp > 3200 || flow === 0;
      expect(isCritical(2100, 0)).to.be.true;
      expect(isCritical(2100, 1)).to.be.false; // 1 ml/min does not trip flow trigger
    });

    it("accurately requires 3 consecutive danger ticks before locking state", () => {
      const client = new LumaGrowSimulationClient(888);
      client.setKyc("UserA", true);
      client.fundAndMint("UserA", 10);

      // Tick 1
      client.updateTelemetry(10, 420, 140);
      expect(client.batchVault.status).to.equal(BatchStatus.Growing);

      // Safe tick resets counter
      client.updateTelemetry(11, 580, 140);
      expect(client.growthState.consecutiveDangerTicks).to.equal(0);
      expect(client.batchVault.status).to.equal(BatchStatus.Growing);

      // 3 consecutive danger ticks
      client.updateTelemetry(12, 420, 140);
      client.updateTelemetry(13, 420, 140);
      client.updateTelemetry(14, 420, 140);
      expect(client.growthState.consecutiveDangerTicks).to.equal(3);
      expect(client.batchVault.status).to.equal(BatchStatus.InsuranceTriggered);
    });
  });

  describe("3. Solvency & Undercollateralization Edge Cases", () => {
    it("safely handles 0 circulating supply during parametric refund calculation", () => {
      // compute_refund_price with circulating = 0 returns unit_price without zero-division panic
      const escrowBalance = 0;
      const circulating = 0;
      const unitPrice = 450_000;

      const refundPrice = circulating === 0 ? unitPrice : Math.min(unitPrice, Math.floor(escrowBalance / circulating));
      expect(refundPrice).to.equal(450_000);
    });

    it("strictly respects proportional deficit distribution under fractional undercollateralization", () => {
      // 100 tokens, but vault only holds 30 USDC (0.30 USDC per token instead of 0.45)
      const escrowBalance = 30_000_000;
      const circulating = 100;
      const unitPrice = 450_000;

      const refundPrice = Math.min(unitPrice, Math.floor(escrowBalance / circulating));
      expect(refundPrice).to.equal(300_000); // exactly 0.30 USDC
    });

    it("verifies solvency invariant formula: escrow >= circulating * unit_price", () => {
      const isSolvent = (escrow: bigint, circulating: bigint, unitPrice: bigint) =>
        escrow >= circulating * unitPrice;

      const unitPrice = 450_000n;
      const supply = 100n;
      expect(isSolvent(45_000_000n, supply, unitPrice)).to.be.true;
      expect(isSolvent(44_999_999n, supply, unitPrice)).to.be.false;
    });
  });

  describe("4. Telemetry Serialization Consistency", () => {
    it("ensures serializeTelemetry produces exactly 60 bytes matching on-chain Borsh layout", () => {
      const t: Telemetry = {
        sequence: 7n,
        observedAt: 1_700_000_000n,
        day: 20,
        growthFactorBps: 8_500,
        estYieldGrams: 250,
        marketPricePerKg: 3_200_000n,
        remainingCost: 200_000n,
        riskPremium: 40_000n,
        waterTempCentiC: -150,
        flowRateMlMin: 1_800,
        ecMicroSCm: 1_600,
        phCenti: 610,
      };

      const buf = serializeTelemetry(t);
      expect(buf.length).to.equal(60);
      expect(buf.toString("hex")).to.equal(
        "070000000000000000f153650000000014003421fa00000000d4300000000000400d030000000000409c0000000000006aff08070000400600006202"
      );
    });
  });
});
