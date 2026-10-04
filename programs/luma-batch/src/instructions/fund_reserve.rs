use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::{BATCH_SEED, RESERVE_SEED};
use crate::errors::LumaError;
use crate::math::checked_add;
use crate::state::{BatchStatus, BatchVault, ReserveVault};

/// Erken çıkış primlerini karşılayacak serbest likiditeyi rezerv kasasına yatırır.
#[derive(Accounts)]
pub struct FundReserve<'info> {
    pub funder: Signer<'info>,

    #[account(
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump,
        has_one = usdc_mint,
        has_one = reserve_vault
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

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

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = funder,
        token::token_program = usdc_token_program
    )]
    pub funder_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, LumaError::ZeroAmount);
    require!(
        ctx.accounts.batch_vault.status == BatchStatus::Active,
        LumaError::BatchNotActive
    );

    transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.funder_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.reserve_usdc.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let reserve = &mut ctx.accounts.reserve_vault;
    reserve.total_funded = checked_add(reserve.total_funded, amount)?;
    Ok(())
}
