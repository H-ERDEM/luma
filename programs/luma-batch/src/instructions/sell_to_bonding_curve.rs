use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{BATCH_SEED, ESCROW_SEED, KYC_SEED, RESERVE_SEED};
use crate::errors::LumaError;
use crate::events::EarlyExitExecuted;
use crate::math::{assert_solvent, checked_add, checked_mul, checked_sub};
use crate::state::{BatchStatus, BatchVault, KycRegistry, ReserveVault, SettlementEscrow};
use crate::transfers::{burn_from_holder, pay_from_pda};

/// Erken çıkış (early_exit_day ≤ gün < harvest_day).
///
/// Ödeme = amount × curve_price. Kaynak önceliği:
/// 1) Escrow'un serbest fazlası: escrow_balance − (supply_after × unit_price).
///    Yakılan token'ların anapara teminatı bu sayede serbest kalır; kalan sahiplerin teminatına dokunulmaz.
/// 2) Büyüme primi ve kalan kısım: ReserveVault (ayrılmış serbest likidite).
/// İşlem sonunda escrow_balance ≥ circulating × unit_price invariantı yeniden doğrulanır.
#[derive(Accounts)]
pub struct SellToBondingCurve<'info> {
    pub seller: Signer<'info>,

    #[account(
        seeds = [KYC_SEED, seller.key().as_ref()],
        bump = kyc_registry.bump,
        constraint = kyc_registry.wallet == seller.key() @ LumaError::KycNotApproved,
        constraint = kyc_registry.is_approved @ LumaError::KycNotApproved
    )]
    pub kyc_registry: Box<Account<'info, KycRegistry>>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump,
        has_one = mint,
        has_one = usdc_mint,
        has_one = settlement_escrow,
        has_one = reserve_vault
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = seller,
        token::token_program = token_program
    )]
    pub seller_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = seller,
        token::token_program = usdc_token_program
    )]
    pub seller_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

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

    #[account(
        mut,
        seeds = [RESERVE_SEED, batch_vault.key().as_ref()],
        bump = reserve_vault.bump,
        has_one = batch_vault,
        has_one = reserve_usdc
    )]
    pub reserve_vault: Box<Account<'info, ReserveVault>>,

    #[account(mut)]
    pub reserve_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

struct ExitQuote {
    payout: u64,
    from_escrow: u64,
    from_reserve: u64,
}

fn quote_exit(ctx: &Context<SellToBondingCurve>, amount: u64, now: i64) -> Result<ExitQuote> {
    let batch = &ctx.accounts.batch_vault;
    require!(batch.status == BatchStatus::Active, LumaError::BatchNotActive);
    require!(
        batch.telemetry.day >= batch.early_exit_day,
        LumaError::EarlyExitNotOpen
    );
    require!(
        batch.telemetry.day < batch.harvest_day,
        LumaError::EarlyExitClosed
    );
    require!(
        !batch.telemetry.is_critical_failure(),
        LumaError::CriticalFailurePending
    );
    require!(
        now.saturating_sub(batch.last_update_ts) <= batch.max_telemetry_age_secs,
        LumaError::StaleTelemetry
    );

    let payout = checked_mul(amount, batch.curve_price)?;
    let supply_after = checked_sub(batch.circulating_supply(), amount)?;
    let collateral_after = checked_mul(supply_after, batch.unit_price)?;
    let escrow_free = ctx.accounts.escrow_usdc.amount.saturating_sub(collateral_after);

    let from_escrow = payout.min(escrow_free);
    let from_reserve = checked_sub(payout, from_escrow)?;
    require!(
        ctx.accounts.reserve_usdc.amount >= from_reserve,
        LumaError::InsufficientExitLiquidity
    );

    Ok(ExitQuote {
        payout,
        from_escrow,
        from_reserve,
    })
}

pub fn handler(ctx: Context<SellToBondingCurve>, amount: u64, min_usdc_out: u64) -> Result<()> {
    require!(amount > 0, LumaError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let quote = quote_exit(&ctx, amount, now)?;
    require!(quote.payout >= min_usdc_out, LumaError::SlippageExceeded);

    burn_from_holder(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.seller_token.to_account_info(),
        ctx.accounts.seller.to_account_info(),
        amount,
    )?;

    let batch_key = ctx.accounts.batch_vault.key();
    let decimals = ctx.accounts.usdc_mint.decimals;

    let escrow_bump = ctx.accounts.settlement_escrow.bump;
    let escrow_seeds: &[&[u8]] = &[ESCROW_SEED, batch_key.as_ref(), &[escrow_bump]];
    pay_from_pda(
        ctx.accounts.usdc_token_program.to_account_info(),
        ctx.accounts.escrow_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.seller_usdc.to_account_info(),
        ctx.accounts.settlement_escrow.to_account_info(),
        &[escrow_seeds],
        quote.from_escrow,
        decimals,
    )?;

    let reserve_bump = ctx.accounts.reserve_vault.bump;
    let reserve_seeds: &[&[u8]] = &[RESERVE_SEED, batch_key.as_ref(), &[reserve_bump]];
    pay_from_pda(
        ctx.accounts.usdc_token_program.to_account_info(),
        ctx.accounts.reserve_usdc.to_account_info(),
        ctx.accounts.usdc_mint.to_account_info(),
        ctx.accounts.seller_usdc.to_account_info(),
        ctx.accounts.reserve_vault.to_account_info(),
        &[reserve_seeds],
        quote.from_reserve,
        decimals,
    )?;

    let batch = &mut ctx.accounts.batch_vault;
    batch.total_burned = checked_add(batch.total_burned, amount)?;
    let circulating = batch.circulating_supply();
    let unit_price = batch.unit_price;

    let escrow = &mut ctx.accounts.settlement_escrow;
    escrow.total_paid_out = checked_add(escrow.total_paid_out, quote.from_escrow)?;
    let reserve = &mut ctx.accounts.reserve_vault;
    reserve.total_paid_out = checked_add(reserve.total_paid_out, quote.from_reserve)?;

    ctx.accounts.escrow_usdc.reload()?;
    ctx.accounts.mint.reload()?;
    require!(
        ctx.accounts.mint.supply == circulating,
        LumaError::SolvencyInvariantViolated
    );
    assert_solvent(ctx.accounts.escrow_usdc.amount, circulating, unit_price)?;

    emit!(EarlyExitExecuted {
        batch_vault: batch_key,
        seller: ctx.accounts.seller.key(),
        amount,
        payout: quote.payout,
        paid_from_escrow: quote.from_escrow,
        paid_from_reserve: quote.from_reserve,
    });
    Ok(())
}
