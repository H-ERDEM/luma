use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{BATCH_SEED, ESCROW_SEED};
use crate::errors::LumaError;
use crate::events::{ParametricDefaultTriggered, TokensRedeemed};
use crate::math::{assert_solvent, checked_add, checked_mul};
use crate::state::{BatchStatus, BatchVault, SettlementEscrow};
use crate::transfers::{burn_from_holder, pay_from_pda};

/// İzinsiz (permissionless) parametrik sigorta tetikleyicisi. Son oracle telemetrisinde
/// su sıcaklığı > 32 °C veya akış = 0 ise parti `Defaulted` olur ve token başına
/// min(unit_price, escrow_balance / circulating) iade hakkı sabitlenir.
#[derive(Accounts)]
pub struct TriggerParametricDefault<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump,
        has_one = settlement_escrow
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

    #[account(
        seeds = [ESCROW_SEED, batch_vault.key().as_ref()],
        bump = settlement_escrow.bump,
        has_one = batch_vault,
        has_one = escrow_usdc
    )]
    pub settlement_escrow: Box<Account<'info, SettlementEscrow>>,

    pub escrow_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn trigger_handler(ctx: Context<TriggerParametricDefault>) -> Result<()> {
    let escrow_balance = ctx.accounts.escrow_usdc.amount;
    let batch = &mut ctx.accounts.batch_vault;
    require!(batch.status == BatchStatus::Active, LumaError::BatchNotActive);
    require!(batch.telemetry.sequence > 0, LumaError::NoTelemetry);
    require!(
        batch.telemetry.is_critical_failure(),
        LumaError::NoDefaultCondition
    );

    let circulating = batch.circulating_supply();
    let refund_price = if circulating == 0 {
        batch.unit_price
    } else {
        batch.unit_price.min(escrow_balance / circulating)
    };

    batch.status = BatchStatus::Defaulted;
    batch.refund_price = refund_price;

    emit!(ParametricDefaultTriggered {
        batch_vault: batch.key(),
        water_temp_centi_c: batch.telemetry.water_temp_centi_c,
        flow_rate_ml_min: batch.telemetry.flow_rate_ml_min,
        refund_price,
    });
    Ok(())
}

/// Temerrüt sonrası token sahibi token'larını yakar ve anaparasını escrow'dan geri alır.
#[derive(Accounts)]
pub struct ClaimDefaultRefund<'info> {
    pub holder: Signer<'info>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump,
        has_one = mint,
        has_one = usdc_mint,
        has_one = settlement_escrow
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = holder,
        token::token_program = token_program
    )]
    pub holder_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = holder,
        token::token_program = usdc_token_program
    )]
    pub holder_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, batch_vault.key().as_ref()],
        bump = settlement_escrow.bump,
        has_one = batch_vault,
        has_one = escrow_usdc
    )]
    pub settlement_escrow: Box<Account<'info, SettlementEscrow>>,

    #[account(mut)]
    pub escrow_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn claim_handler(ctx: Context<ClaimDefaultRefund>, amount: u64) -> Result<()> {
    require!(amount > 0, LumaError::ZeroAmount);
    let batch = &ctx.accounts.batch_vault;
    require!(
        batch.status == BatchStatus::Defaulted,
        LumaError::BatchNotDefaulted
    );
    let payout = checked_mul(amount, batch.refund_price)?;
    require!(
        ctx.accounts.escrow_usdc.amount >= payout,
        LumaError::InsufficientEscrowLiquidity
    );

    burn_from_holder(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.holder_token.to_account_info(),
        ctx.accounts.holder.to_account_info(),
        amount,
    )?;

    let batch_key = batch.key();
    let escrow_seeds: &[&[u8]] = &[
        ESCROW_SEED,
        batch_key.as_ref(),
        &[ctx.accounts.settlement_escrow.bump],
    ];
    pay_from_pda(
        ctx.accounts.usdc_token_program.to_account_info(),
        ctx.accounts.escrow_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.holder_usdc.to_account_info(),
        ctx.accounts.settlement_escrow.to_account_info(),
        &[escrow_seeds],
        payout,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let batch = &mut ctx.accounts.batch_vault;
    batch.total_burned = checked_add(batch.total_burned, amount)?;
    let circulating = batch.circulating_supply();
    let refund_price = batch.refund_price;

    let escrow = &mut ctx.accounts.settlement_escrow;
    escrow.total_paid_out = checked_add(escrow.total_paid_out, payout)?;

    ctx.accounts.escrow_usdc.reload()?;
    assert_solvent(ctx.accounts.escrow_usdc.amount, circulating, refund_price)?;

    emit!(TokensRedeemed {
        batch_vault: batch_key,
        holder: ctx.accounts.holder.key(),
        amount,
        payout,
        default_refund: true,
    });
    Ok(())
}
