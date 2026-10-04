use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::LumaError;
use crate::state::ProtocolConfig;

/// Yetki anahtarlarının rotasyonu (ör. ele geçirilmiş fallback anahtarı veya yeni DON imzacısı).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigParams {
    pub kyc_authority: Option<Pubkey>,
    pub don_authority: Option<Pubkey>,
    pub fallback_authority: Option<Pubkey>,
    pub new_admin: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LumaError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(key) = params.kyc_authority {
        require_keys_neq!(key, Pubkey::default(), LumaError::InvalidAuthority);
        config.kyc_authority = key;
    }
    if let Some(key) = params.don_authority {
        require_keys_neq!(key, Pubkey::default(), LumaError::InvalidAuthority);
        config.don_authority = key;
    }
    if let Some(key) = params.fallback_authority {
        require_keys_neq!(key, Pubkey::default(), LumaError::InvalidAuthority);
        config.fallback_authority = key;
    }
    if let Some(key) = params.new_admin {
        require_keys_neq!(key, Pubkey::default(), LumaError::InvalidAuthority);
        config.admin = key;
    }
    Ok(())
}
