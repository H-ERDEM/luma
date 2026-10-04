use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{
    mint_to, transfer_checked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::{BATCH_SEED, ESCROW_SEED, KYC_SEED};
use crate::errors::LumaError;
use crate::events::SeedlingsFunded;
use crate::math::{checked_add, checked_mul};
use crate::state::{BatchStatus, BatchVault, KycRegistry, SettlementEscrow};

/// KYC onaylı yatırımcı `quantity × unit_price` USDC öder; karşılığında `quantity` adet
/// Token-2022 fide token'ı basılır. Ödenen USDC'nin tamamı anapara teminatı olarak escrow'a gider.
#[derive(Accounts)]
pub struct FundAndMint<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        seeds = [KYC_SEED, buyer.key().as_ref()],
        bump = kyc_registry.bump,
        constraint = kyc_registry.wallet == buyer.key() @ LumaError::KycNotApproved,
        constraint = kyc_registry.is_approved @ LumaError::KycNotApproved
    )]
    pub kyc_registry: Box<Account<'info, KycRegistry>>,

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
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer,
        token::token_program = usdc_token_program
    )]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

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
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FundAndMint>, quantity: u64) -> Result<()> {
    require!(quantity > 0, LumaError::ZeroAmount);

    let batch = &ctx.accounts.batch_vault;
    require!(batch.status == BatchStatus::Active, LumaError::BatchNotActive);
    require!(
        batch.telemetry.day <= batch.funding_close_day,
        LumaError::FundingClosed
    );
    let circulating_after = checked_add(batch.circulating_supply(), quantity)?;
    require!(
        circulating_after <= batch.max_supply,
        LumaError::MaxSupplyExceeded
    );
    let cost = checked_mul(quantity, batch.unit_price)?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.escrow_usdc.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        cost,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let batch_id_bytes = batch.batch_id.to_le_bytes();
    let batch_seeds: &[&[u8]] = &[BATCH_SEED, batch_id_bytes.as_ref(), &[batch.bump]];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyer_token.to_account_info(),
                authority: ctx.accounts.batch_vault.to_account_info(),
            },
            &[batch_seeds],
        ),
        quantity,
    )?;

    let escrow = &mut ctx.accounts.settlement_escrow;
    escrow.principal_deposited = checked_add(escrow.principal_deposited, cost)?;

    let batch = &mut ctx.accounts.batch_vault;
    batch.total_minted = checked_add(batch.total_minted, quantity)?;

    emit!(SeedlingsFunded {
        batch_vault: batch.key(),
        buyer: ctx.accounts.buyer.key(),
        quantity,
        usdc_paid: cost,
    });
    Ok(())
}
