use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::CONFIG_SEED;
use crate::errors::LumaError;
use crate::state::ProtocolConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigParams {
    pub kyc_authority: Pubkey,
    pub don_authority: Pubkey,
    pub fallback_authority: Pubkey,
    pub transfer_hook_program: Pubkey,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfig>, params: InitializeConfigParams) -> Result<()> {
    for key in [
        params.kyc_authority,
        params.don_authority,
        params.fallback_authority,
        params.transfer_hook_program,
    ] {
        require_keys_neq!(key, Pubkey::default(), LumaError::InvalidAuthority);
    }

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.kyc_authority = params.kyc_authority;
    config.don_authority = params.don_authority;
    config.fallback_authority = params.fallback_authority;
    config.transfer_hook_program = params.transfer_hook_program;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.batch_count = 0;
    config.bump = ctx.bumps.config;
    Ok(())
}
