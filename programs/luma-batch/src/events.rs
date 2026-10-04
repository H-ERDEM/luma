use anchor_lang::prelude::*;

use crate::state::OracleSource;

#[event]
pub struct BatchInitialized {
    pub batch_vault: Pubkey,
    pub mint: Pubkey,
    pub batch_id: u64,
    pub unit_price: u64,
    pub max_supply: u64,
}

#[event]
pub struct SeedlingsFunded {
    pub batch_vault: Pubkey,
    pub buyer: Pubkey,
    pub quantity: u64,
    pub usdc_paid: u64,
}

#[event]
pub struct TelemetryUpdated {
    pub batch_vault: Pubkey,
    pub sequence: u64,
    pub day: u16,
    pub source: OracleSource,
    pub fair_value: i64,
    pub curve_price: u64,
}

#[event]
pub struct EarlyExitExecuted {
    pub batch_vault: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub payout: u64,
    pub paid_from_escrow: u64,
    pub paid_from_reserve: u64,
}

#[event]
pub struct ParametricDefaultTriggered {
    pub batch_vault: Pubkey,
    pub water_temp_centi_c: i16,
    pub flow_rate_ml_min: u32,
    pub refund_price: u64,
}

#[event]
pub struct HarvestSettled {
    pub batch_vault: Pubkey,
    pub otc_usdc_amount: u64,
    pub redemption_price: u64,
}

#[event]
pub struct TokensRedeemed {
    pub batch_vault: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub payout: u64,
    pub default_refund: bool,
}
