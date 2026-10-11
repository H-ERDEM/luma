//! Sabit noktalı ekonomik hesaplamalar. Tüm ara değerler i128/u128 ile taşmaya karşı korunur.

use anchor_lang::prelude::*;

use crate::constants::{BPS_DENOMINATOR, GRAMS_PER_KG};
use crate::errors::LumaError;
use crate::state::TelemetryPayload;

/// FV_t = (Q_est × P_market × B_t) − (C_rem × (1 − B_t)) − RP_t   [mikro-USDC / fide]
pub fn compute_fair_value(p: &TelemetryPayload) -> Result<i64> {
    require!(
        u64::from(p.growth_factor_bps) <= BPS_DENOMINATOR,
        LumaError::InvalidGrowthFactor
    );
    let bps = i128::from(BPS_DENOMINATOR);
    let b_t = i128::from(p.growth_factor_bps);

    let gross_value = i128::from(p.est_yield_grams)
        .checked_mul(i128::from(p.market_price_per_kg))
        .and_then(|v| v.checked_mul(b_t))
        .and_then(|v| v.checked_div(i128::from(GRAMS_PER_KG) * bps))
        .ok_or(LumaError::MathOverflow)?;

    let remaining_cost_drag = i128::from(p.remaining_cost)
        .checked_mul(bps - b_t)
        .and_then(|v| v.checked_div(bps))
        .ok_or(LumaError::MathOverflow)?;

    let fair_value = gross_value
        .checked_sub(remaining_cost_drag)
        .and_then(|v| v.checked_sub(i128::from(p.risk_premium)))
        .ok_or(LumaError::MathOverflow)?;

    i64::try_from(fair_value).map_err(|_| error!(LumaError::MathOverflow))
}

/// Bonding curve fiyatı anapara korumalıdır: FV_t hiçbir zaman ilk birim fiyatın altına çekmez.
pub fn curve_price(fair_value: i64, unit_price: u64) -> u64 {
    if fair_value <= 0 {
        return unit_price;
    }
    let fv = fair_value as u64;
    fv.max(unit_price)
}

pub fn checked_mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or_else(|| error!(LumaError::MathOverflow))
}

pub fn checked_add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(LumaError::MathOverflow))
}

pub fn checked_sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(LumaError::MathOverflow))
}

/// value × bps / 10_000, aşağı yuvarlanır.
pub fn apply_bps(value: u64, bps: u64) -> Result<u64> {
    let r = u128::from(value)
        .checked_mul(u128::from(bps))
        .and_then(|v| v.checked_div(u128::from(BPS_DENOMINATOR)))
        .ok_or(LumaError::MathOverflow)?;
    u64::try_from(r).map_err(|_| error!(LumaError::MathOverflow))
}

/// Parametrik temerrüt durumunda token başına iade fiyatını sıfıra bölme korumasıyla hesaplar.
/// circulating == 0 ise unit_price döner. Aksi halde min(unit_price, escrow_balance / circulating).
pub fn compute_refund_price(escrow_balance: u64, circulating: u64, unit_price: u64) -> Result<u64> {
    if circulating == 0 {
        return Ok(unit_price);
    }
    let share = u128::from(escrow_balance)
        .checked_div(u128::from(circulating))
        .ok_or(LumaError::MathOverflow)?;
    let share_u64 = u64::try_from(share).map_err(|_| error!(LumaError::MathOverflow))?;
    Ok(unit_price.min(share_u64))
}

/// Hasat itfasında protokol komisyonunu düştükten sonra token başına itfa tutarını hesaplar.
/// Anapara koruma tabanı (unit_price) ile güvenceye alınır.
pub fn compute_redemption_price(curve_price: u64, harvest_fee_bps: u16, unit_price: u64) -> Result<u64> {
    require!(
        u64::from(harvest_fee_bps) <= BPS_DENOMINATOR,
        LumaError::MathOverflow
    );
    let net_bps = BPS_DENOMINATOR - u64::from(harvest_fee_bps);
    let net_price = apply_bps(curve_price, net_bps)?;
    Ok(net_price.max(unit_price))
}

/// Solvency invariantı: escrow_balance ≥ circulating × unit_price.
pub fn assert_solvent(escrow_balance: u64, circulating: u64, unit_price: u64) -> Result<()> {
    let required = u128::from(circulating)
        .checked_mul(u128::from(unit_price))
        .ok_or(LumaError::MathOverflow)?;
    require!(
        u128::from(escrow_balance) >= required,
        LumaError::SolvencyInvariantViolated
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(day: u16, b_bps: u16, c_rem: u64) -> TelemetryPayload {
        TelemetryPayload {
            sequence: 1,
            observed_at: 0,
            day,
            growth_factor_bps: b_bps,
            est_yield_grams: 250,
            market_price_per_kg: 3_200_000,
            remaining_cost: c_rem,
            risk_premium: 40_000,
            water_temp_centi_c: 2_100,
            flow_rate_ml_min: 1_800,
            ec_micro_s_cm: 1_600,
            ph_centi: 610,
        }
    }

    #[test]
    fn day_zero_is_floored_at_unit_price() {
        let fv = compute_fair_value(&payload(0, 0, 400_000)).unwrap();
        assert_eq!(fv, -440_000);
        assert_eq!(curve_price(fv, 450_000), 450_000);
    }

    #[test]
    fn day_twenty_prices_at_0_61() {
        let fv = compute_fair_value(&payload(20, 8_500, 200_000)).unwrap();
        assert_eq!(fv, 610_000);
        assert_eq!(curve_price(fv, 450_000), 610_000);
    }

    #[test]
    fn day_forty_prices_at_0_76_and_redeems_at_0_7125() {
        let fv = compute_fair_value(&payload(40, 10_000, 0)).unwrap();
        assert_eq!(fv, 760_000);
        assert_eq!(apply_bps(fv as u64, 10_000 - 625).unwrap(), 712_500);
        let redemption = compute_redemption_price(fv as u64, 625, 450_000).unwrap();
        assert_eq!(redemption, 712_500);
    }

    #[test]
    fn growth_factor_above_one_is_rejected() {
        assert!(compute_fair_value(&payload(10, 10_001, 0)).is_err());
    }

    #[test]
    fn solvency_check() {
        assert!(assert_solvent(450_000 * 100, 100, 450_000).is_ok());
        assert!(assert_solvent(450_000 * 100 - 1, 100, 450_000).is_err());
    }

    #[test]
    fn test_zero_circulating_refund_price_is_safe() {
        let refund = compute_refund_price(0, 0, 450_000).unwrap();
        assert_eq!(refund, 450_000);
    }

    #[test]
    fn test_undercollateralized_refund_price_is_fractional() {
        // Escrow only has 30 USDC, but 100 tokens circulating (0.30 USDC per token instead of 0.45)
        let refund = compute_refund_price(30_000_000, 100, 450_000).unwrap();
        assert_eq!(refund, 300_000);
    }

    #[test]
    fn test_overcollateralized_refund_price_is_capped_at_unit_price() {
        // Escrow has 50 USDC for 100 tokens: refund capped at unit_price (450_000)
        let refund = compute_refund_price(50_000_000, 100, 450_000).unwrap();
        assert_eq!(refund, 450_000);
    }

    #[test]
    fn test_redemption_price_floored_at_unit_price_under_collapse() {
        // Even if market crashed and curve_price is 400_000 (below unit price),
        // redemption never falls below 450_000
        let redemption = compute_redemption_price(400_000, 625, 450_000).unwrap();
        assert_eq!(redemption, 450_000);
    }

    #[test]
    fn test_extreme_market_price_overflow_handling() {
        let mut p = payload(40, 10_000, 0);
        p.market_price_per_kg = u64::MAX;
        p.est_yield_grams = u32::MAX;
        // Should safely fail with MathOverflow rather than panicking
        assert!(compute_fair_value(&p).is_err());
    }

    #[test]
    fn test_critical_failure_predicates() {
        let mut p = payload(15, 5_000, 300_000);
        p.water_temp_centi_c = 3_200; // 32.00 °C: borderline safe
        p.flow_rate_ml_min = 1_000;
        assert!(!p.is_critical_failure());

        p.water_temp_centi_c = 3_201; // 32.01 °C: exceeds threshold -> critical failure
        assert!(p.is_critical_failure());

        p.water_temp_centi_c = 2_100;
        p.flow_rate_ml_min = 0; // Pump failure (0 ml/min) -> critical failure
        assert!(p.is_critical_failure());
    }

    #[test]
    fn test_sub_zero_temperature_reading() {
        let mut p = payload(10, 3_000, 350_000);
        p.water_temp_centi_c = -200; // -2.00 °C
        // Does not trigger high-temp default, but maintains math stability
        assert!(!p.is_critical_failure());
        assert!(compute_fair_value(&p).is_ok());
    }
}
