//! LUMA Batch — canlı varlık kanıtı (Proof-of-Asset) ile desteklenen tarımsal üretim partileri.
//!
//! Akış: initialize_config → set_kyc_status → initialize_batch + initialize_batch_mint → (hook) initialize_extra_account_meta_list
//! → fund_reserve → fund_and_mint → update_telemetry* → sell_to_bonding_curve | trigger_parametric_default
//! → claim_default_refund | settle_harvest → redeem_and_burn

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod transfers;

use instructions::*;
use state::TelemetryPayload;

declare_id!("A7d9dA7vCcVQEoMPVoTgTmNRoRHvPk9VqurhTKWLRGmM");

#[program]
pub mod luma_batch {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        params: InitializeConfigParams,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, params)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        instructions::update_config::handler(ctx, params)
    }

    pub fn set_kyc_status(ctx: Context<SetKycStatus>, wallet: Pubkey, approved: bool) -> Result<()> {
        instructions::set_kyc_status::handler(ctx, wallet, approved)
    }

    pub fn initialize_batch(
        ctx: Context<InitializeBatch>,
        params: InitializeBatchParams,
    ) -> Result<()> {
        instructions::initialize_batch::handler(ctx, params)
    }

    pub fn initialize_batch_mint(ctx: Context<InitializeBatchMint>) -> Result<()> {
        instructions::initialize_batch::mint_handler(ctx)
    }

    pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
        instructions::fund_reserve::handler(ctx, amount)
    }

    pub fn fund_and_mint(ctx: Context<FundAndMint>, quantity: u64) -> Result<()> {
        instructions::fund_and_mint::handler(ctx, quantity)
    }

    pub fn update_telemetry(ctx: Context<UpdateTelemetry>, payload: TelemetryPayload) -> Result<()> {
        instructions::update_telemetry::handler(ctx, payload)
    }

    pub fn sell_to_bonding_curve(
        ctx: Context<SellToBondingCurve>,
        amount: u64,
        min_usdc_out: u64,
    ) -> Result<()> {
        instructions::sell_to_bonding_curve::handler(ctx, amount, min_usdc_out)
    }

    pub fn trigger_parametric_default(ctx: Context<TriggerParametricDefault>) -> Result<()> {
        instructions::trigger_parametric_default::trigger_handler(ctx)
    }

    pub fn claim_default_refund(ctx: Context<ClaimDefaultRefund>, amount: u64) -> Result<()> {
        instructions::trigger_parametric_default::claim_handler(ctx, amount)
    }

    pub fn settle_harvest(ctx: Context<SettleHarvest>, otc_usdc_amount: u64) -> Result<()> {
        instructions::settle_harvest_and_burn::settle_handler(ctx, otc_usdc_amount)
    }

    pub fn redeem_and_burn(ctx: Context<RedeemAndBurn>, amount: u64) -> Result<()> {
        instructions::settle_harvest_and_burn::redeem_handler(ctx, amount)
    }
}
