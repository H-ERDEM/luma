use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, KYC_SEED};
use crate::errors::LumaError;
use crate::state::{KycRegistry, ProtocolConfig};

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct SetKycStatus<'info> {
    #[account(mut)]
    pub kyc_authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = kyc_authority @ LumaError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        init_if_needed,
        payer = kyc_authority,
        space = 8 + KycRegistry::INIT_SPACE,
        seeds = [KYC_SEED, wallet.as_ref()],
        bump
    )]
    pub kyc_registry: Account<'info, KycRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetKycStatus>, wallet: Pubkey, approved: bool) -> Result<()> {
    require_keys_neq!(wallet, Pubkey::default(), LumaError::InvalidAuthority);
    let registry = &mut ctx.accounts.kyc_registry;
    registry.wallet = wallet;
    registry.is_approved = approved;
    registry.updated_at = Clock::get()?.unix_timestamp;
    registry.bump = ctx.bumps.kyc_registry;
    Ok(())
}
