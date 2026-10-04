use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{BATCH_SEED, BPS_DENOMINATOR, ESCROW_SEED};
use crate::errors::LumaError;
use crate::events::{HarvestSettled, TokensRedeemed};
use crate::math::{apply_bps, assert_solvent, checked_add, checked_mul};
use crate::state::{BatchStatus, BatchVault, SettlementEscrow};
use crate::transfers::{burn_from_holder, pay_from_pda};

/// Hasat günü: parti yöneticisi OTC alıcısından gelen USDC'yi escrow'a yatırır.
/// İtfa fiyatı = max(curve_price × (1 − harvest_fee_bps), unit_price) olarak sabitlenir
/// (varsayılan: 0.76 × 0.9375 = 0.7125 USDC). Escrow tüm dolaşımı bu fiyattan
/// karşılayamıyorsa uzlaşma reddedilir.
#[derive(Accounts)]
pub struct SettleHarvest<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump,
        has_one = admin @ LumaError::Unauthorized,
        has_one = usdc_mint,
        has_one = settlement_escrow
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

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

    /// OTC alıcısından alınan USDC'nin bulunduğu yönetici hesabı.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = admin,
        token::token_program = usdc_token_program
    )]
    pub otc_source_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn settle_handler(ctx: Context<SettleHarvest>, otc_usdc_amount: u64) -> Result<()> {
    let batch = &ctx.accounts.batch_vault;
    require!(batch.status == BatchStatus::Active, LumaError::BatchNotActive);
    require!(
        batch.telemetry.day >= batch.harvest_day,
        LumaError::HarvestNotReached
    );
    require!(
        !batch.telemetry.is_critical_failure(),
        LumaError::CriticalFailurePending
    );

    let fee_complement = BPS_DENOMINATOR - u64::from(batch.harvest_fee_bps);
    let redemption_price = apply_bps(batch.curve_price, fee_complement)?.max(batch.unit_price);
    let circulating = batch.circulating_supply();

    if otc_usdc_amount > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.otc_source_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.escrow_usdc.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                },
            ),
            otc_usdc_amount,
            ctx.accounts.usdc_mint.decimals,
        )?;
    }

    ctx.accounts.escrow_usdc.reload()?;
    let required = u128::from(circulating) * u128::from(redemption_price);
    require!(
        u128::from(ctx.accounts.escrow_usdc.amount) >= required,
        LumaError::InsufficientEscrowLiquidity
    );

    let escrow = &mut ctx.accounts.settlement_escrow;
    escrow.otc_deposited = checked_add(escrow.otc_deposited, otc_usdc_amount)?;

    let batch = &mut ctx.accounts.batch_vault;
    batch.status = BatchStatus::Settled;
    batch.redemption_price = redemption_price;

    emit!(HarvestSettled {
        batch_vault: batch.key(),
        otc_usdc_amount,
        redemption_price,
    });
    Ok(())
}

/// Uzlaşma sonrası token sahibi token'larını yakar ve `redemption_price` üzerinden USDC alır.
#[derive(Accounts)]
pub struct RedeemAndBurn<'info> {
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

pub fn redeem_handler(ctx: Context<RedeemAndBurn>, amount: u64) -> Result<()> {
    require!(amount > 0, LumaError::ZeroAmount);
    let batch = &ctx.accounts.batch_vault;
    require!(
        batch.status == BatchStatus::Settled,
        LumaError::BatchNotSettled
    );
    let payout = checked_mul(amount, batch.redemption_price)?;
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
    let redemption_price = batch.redemption_price;

    let escrow = &mut ctx.accounts.settlement_escrow;
    escrow.total_paid_out = checked_add(escrow.total_paid_out, payout)?;

    ctx.accounts.escrow_usdc.reload()?;
    assert_solvent(ctx.accounts.escrow_usdc.amount, circulating, redemption_price)?;

    emit!(TokensRedeemed {
        batch_vault: batch_key,
        holder: ctx.accounts.holder.key(),
        amount,
        payout,
        default_refund: false,
    });
    Ok(())
}
