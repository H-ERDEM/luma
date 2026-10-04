use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{
    BATCH_SEED, BPS_DENOMINATOR, CONFIG_SEED, ESCROW_SEED, MINT_SEED, RESERVE_SEED, TOKEN_DECIMALS,
};
use crate::errors::LumaError;
use crate::events::BatchInitialized;
use crate::state::{
    BatchStatus, BatchVault, OracleSource, ProtocolConfig, ReserveVault, SettlementEscrow,
    TelemetryPayload,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeBatchParams {
    pub unit_price: u64,
    pub max_supply: u64,
    pub funding_close_day: u16,
    pub early_exit_day: u16,
    pub harvest_day: u16,
    pub harvest_fee_bps: u16,
    pub max_telemetry_age_secs: i64,
}

impl InitializeBatchParams {
    fn validate(&self) -> Result<()> {
        require!(self.unit_price > 0, LumaError::InvalidBatchParams);
        require!(self.max_supply > 0, LumaError::InvalidBatchParams);
        require!(
            self.funding_close_day < self.early_exit_day && self.early_exit_day < self.harvest_day,
            LumaError::InvalidBatchParams
        );
        require!(
            u64::from(self.harvest_fee_bps) < BPS_DENOMINATOR,
            LumaError::InvalidBatchParams
        );
        require!(self.max_telemetry_age_secs > 0, LumaError::InvalidBatchParams);
        Ok(())
    }
}

/// Parti durum hesaplarını (BatchVault, SettlementEscrow, ReserveVault) ve USDC ATA'larını oluşturur.
/// Token-2022 mint'i, SBF stack sınırını aşmamak için `initialize_batch_mint` talimatında
/// oluşturulur; bu talimat yalnızca mint PDA'sının adresini kaydeder. İki talimat aynı işlemde
/// gönderilmelidir.
#[derive(Accounts)]
pub struct InitializeBatch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ LumaError::Unauthorized,
        has_one = usdc_mint
    )]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        init,
        payer = admin,
        space = 8 + BatchVault::INIT_SPACE,
        seeds = [BATCH_SEED, config.batch_count.to_le_bytes().as_ref()],
        bump
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

    /// CHECK: Adresi `[MINT_SEED, batch_vault]` PDA'sına kilitlidir; hesap `initialize_batch_mint`
    /// talimatında oluşturulur.
    #[account(seeds = [MINT_SEED, batch_vault.key().as_ref()], bump)]
    pub mint: UncheckedAccount<'info>,

    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        space = 8 + SettlementEscrow::INIT_SPACE,
        seeds = [ESCROW_SEED, batch_vault.key().as_ref()],
        bump
    )]
    pub settlement_escrow: Box<Account<'info, SettlementEscrow>>,

        /// CHECK: handler içinde ATA programıyla oluşturulur; adres ATA programı tarafından doğrulanır.
    #[account(mut)]
    pub escrow_usdc: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + ReserveVault::INIT_SPACE,
        seeds = [RESERVE_SEED, batch_vault.key().as_ref()],
        bump
    )]
    pub reserve_vault: Box<Account<'info, ReserveVault>>,

        /// CHECK: handler içinde ATA programıyla oluşturulur; adres ATA programı tarafından doğrulanır.
    #[account(mut)]
    pub reserve_usdc: UncheckedAccount<'info>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeBatch>, params: InitializeBatchParams) -> Result<()> {
    params.validate()?;

        associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer: ctx.accounts.admin.to_account_info(),
            associated_token: ctx.accounts.escrow_usdc.to_account_info(),
            authority: ctx.accounts.settlement_escrow.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.usdc_token_program.to_account_info(),
        },
    ))?;
    associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer: ctx.accounts.admin.to_account_info(),
            associated_token: ctx.accounts.reserve_usdc.to_account_info(),
            authority: ctx.accounts.reserve_vault.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.usdc_token_program.to_account_info(),
        },
    ))?;

    let batch_key = ctx.accounts.batch_vault.key();
    let config = &mut ctx.accounts.config;
    let batch_id = config.batch_count;
    config.batch_count = config.batch_count.checked_add(1).ok_or(LumaError::MathOverflow)?;

    let batch = &mut ctx.accounts.batch_vault;
    batch.admin = ctx.accounts.admin.key();
    batch.batch_id = batch_id;
    batch.mint = ctx.accounts.mint.key();
    batch.usdc_mint = ctx.accounts.usdc_mint.key();
    batch.settlement_escrow = ctx.accounts.settlement_escrow.key();
    batch.reserve_vault = ctx.accounts.reserve_vault.key();
    batch.unit_price = params.unit_price;
    batch.max_supply = params.max_supply;
    batch.total_minted = 0;
    batch.total_burned = 0;
    batch.funding_close_day = params.funding_close_day;
    batch.early_exit_day = params.early_exit_day;
    batch.harvest_day = params.harvest_day;
    batch.harvest_fee_bps = params.harvest_fee_bps;
    batch.max_telemetry_age_secs = params.max_telemetry_age_secs;
    batch.status = BatchStatus::Active;
    batch.telemetry = TelemetryPayload::default();
    batch.last_oracle_source = OracleSource::None;
    batch.last_update_ts = 0;
    batch.fair_value = 0;
    batch.curve_price = params.unit_price;
    batch.refund_price = 0;
    batch.redemption_price = 0;
    batch.bump = ctx.bumps.batch_vault;
    batch.mint_bump = ctx.bumps.mint;

    let escrow = &mut ctx.accounts.settlement_escrow;
    escrow.batch_vault = batch_key;
    escrow.escrow_usdc = ctx.accounts.escrow_usdc.key();
    escrow.principal_deposited = 0;
    escrow.otc_deposited = 0;
    escrow.total_paid_out = 0;
    escrow.bump = ctx.bumps.settlement_escrow;

    let reserve = &mut ctx.accounts.reserve_vault;
    reserve.batch_vault = batch_key;
    reserve.reserve_usdc = ctx.accounts.reserve_usdc.key();
    reserve.total_funded = 0;
    reserve.total_paid_out = 0;
    reserve.bump = ctx.bumps.reserve_vault;

    emit!(BatchInitialized {
        batch_vault: batch_key,
        mint: ctx.accounts.mint.key(),
        batch_id,
        unit_price: params.unit_price,
        max_supply: params.max_supply,
    });
    Ok(())
}

/// Token-2022 mint'i şu yapılandırmayla oluşturur:
/// mint authority = freeze authority = transfer hook authority = BatchVault PDA,
/// transfer hook programı = ProtocolConfig.transfer_hook_program.
/// `initialize_batch` ile aynı işlemde, ondan sonra çağrılmalıdır.
#[derive(Accounts)]
pub struct InitializeBatchMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump,
        has_one = admin @ LumaError::Unauthorized,
        has_one = mint
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

    #[account(
        init,
        payer = admin,
        seeds = [MINT_SEED, batch_vault.key().as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = batch_vault,
        mint::freeze_authority = batch_vault,
        mint::token_program = token_program,
        extensions::transfer_hook::authority = batch_vault,
        extensions::transfer_hook::program_id = config.transfer_hook_program,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn mint_handler(_ctx: Context<InitializeBatchMint>) -> Result<()> {
    Ok(())
}
