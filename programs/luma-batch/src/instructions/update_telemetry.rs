use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{
    self as ix_sysvar, load_current_index_checked, load_instruction_at_checked,
};

use crate::constants::{
    BATCH_SEED, CONFIG_SEED, ED25519_HEADER_LEN, ED25519_PUBKEY_LEN, ED25519_SIGNATURE_LEN,
    MAX_CLOCK_DRIFT_SECS, MAX_PH_CENTI, TELEMETRY_DOMAIN,
};
use crate::errors::LumaError;
use crate::events::TelemetryUpdated;
use crate::math::{compute_fair_value, curve_price};
use crate::state::{BatchStatus, BatchVault, OracleSource, ProtocolConfig, TelemetryPayload};

/// Çift katmanlı oracle yetkilendirmesi:
/// 1) `relayer == config.don_authority` → Chainlink DON yolu (imzacı doğrudan işlemi imzalar).
/// 2) Aksi halde, bu talimattan hemen önce `config.fallback_authority` ile imzalanmış ve
///    `TELEMETRY_DOMAIN || batch_vault || borsh(payload)` mesajını doğrulayan bir Ed25519
///    native program talimatı bulunmalıdır. Herhangi bir hesap bu durumda relayer olabilir.
#[derive(Accounts)]
pub struct UpdateTelemetry<'info> {
    pub relayer: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [BATCH_SEED, batch_vault.batch_id.to_le_bytes().as_ref()],
        bump = batch_vault.bump
    )]
    pub batch_vault: Box<Account<'info, BatchVault>>,

    /// CHECK: Instructions sysvar'ı bir Anchor tipine sahip değildir; adresi sabit sysvar ID'sine
    /// kilitlenmiştir ve yalnızca `load_*_checked` yardımcılarıyla okunur.
    #[account(address = ix_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<UpdateTelemetry>, payload: TelemetryPayload) -> Result<()> {
    let batch_key = ctx.accounts.batch_vault.key();
    let source = authorize_oracle(&ctx, &batch_key, &payload)?;

    let now = Clock::get()?.unix_timestamp;
    let batch = &mut ctx.accounts.batch_vault;
    validate_payload(batch, &payload, now)?;

    let fair_value = compute_fair_value(&payload)?;
    let price = curve_price(fair_value, batch.unit_price);

    batch.telemetry = payload;
    batch.last_oracle_source = source;
    batch.last_update_ts = now;
    batch.fair_value = fair_value;
    batch.curve_price = price;

    emit!(TelemetryUpdated {
        batch_vault: batch_key,
        sequence: payload.sequence,
        day: payload.day,
        source,
        fair_value,
        curve_price: price,
    });
    Ok(())
}

fn authorize_oracle(
    ctx: &Context<UpdateTelemetry>,
    batch_key: &Pubkey,
    payload: &TelemetryPayload,
) -> Result<OracleSource> {
    if ctx.accounts.relayer.key() == ctx.accounts.config.don_authority {
        return Ok(OracleSource::ChainlinkDon);
    }

    let mut expected_message = Vec::with_capacity(TELEMETRY_DOMAIN.len() + 32 + 64);
    expected_message.extend_from_slice(TELEMETRY_DOMAIN);
    expected_message.extend_from_slice(batch_key.as_ref());
    payload.serialize(&mut expected_message)?;

    verify_preceding_ed25519(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &ctx.accounts.config.fallback_authority,
        &expected_message,
    )?;
    Ok(OracleSource::AuthorityEd25519)
}

/// Ed25519 precompile talimatının veri düzeni:
/// [0] num_signatures, [1] padding, ardından 7 adet u16 LE:
/// signature_offset, signature_ix_index, pubkey_offset, pubkey_ix_index,
/// message_offset, message_size, message_ix_index.
/// İmza geçerliliğini runtime precompile doğrular; burada imzacı ve mesajın bizim
/// beklediğimiz değerler olduğunu ve verinin aynı talimat içinde olduğunu doğrularız.
fn verify_preceding_ed25519(
    sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(sysvar)?;
    require!(current_index > 0, LumaError::UnauthorizedOracle);

    let ix = load_instruction_at_checked(usize::from(current_index - 1), sysvar)
        .map_err(|_| error!(LumaError::InvalidEd25519Instruction))?;
    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        LumaError::UnauthorizedOracle
    );
    require!(ix.accounts.is_empty(), LumaError::InvalidEd25519Instruction);

    let data = ix.data.as_slice();
    require!(
        data.len() >= ED25519_HEADER_LEN && data[0] == 1,
        LumaError::InvalidEd25519Instruction
    );

    let read_u16 = |offset: usize| -> usize { usize::from(u16::from_le_bytes([data[offset], data[offset + 1]])) };
    let signature_offset = read_u16(2);
    let signature_ix_index = read_u16(4);
    let pubkey_offset = read_u16(6);
    let pubkey_ix_index = read_u16(8);
    let message_offset = read_u16(10);
    let message_size = read_u16(12);
    let message_ix_index = read_u16(14);

    let same_instruction = usize::from(u16::MAX);
    require!(
        signature_ix_index == same_instruction
            && pubkey_ix_index == same_instruction
            && message_ix_index == same_instruction,
        LumaError::InvalidEd25519Instruction
    );
    require!(
        signature_offset + ED25519_SIGNATURE_LEN <= data.len()
            && pubkey_offset + ED25519_PUBKEY_LEN <= data.len()
            && message_offset + message_size <= data.len(),
        LumaError::InvalidEd25519Instruction
    );

    require!(
        &data[pubkey_offset..pubkey_offset + ED25519_PUBKEY_LEN] == expected_signer.as_ref(),
        LumaError::Ed25519AuthorityMismatch
    );
    require!(
        &data[message_offset..message_offset + message_size] == expected_message,
        LumaError::Ed25519MessageMismatch
    );
    Ok(())
}

fn validate_payload(batch: &BatchVault, payload: &TelemetryPayload, now: i64) -> Result<()> {
    require!(batch.status == BatchStatus::Active, LumaError::BatchNotActive);
    require!(
        payload.sequence > batch.telemetry.sequence,
        LumaError::StaleSequence
    );
    require!(
        payload.observed_at <= now.saturating_add(MAX_CLOCK_DRIFT_SECS),
        LumaError::TelemetryFromFuture
    );
    require!(
        now.saturating_sub(payload.observed_at) <= batch.max_telemetry_age_secs,
        LumaError::StaleTelemetry
    );
    require!(
        payload.day >= batch.telemetry.day && payload.day <= batch.harvest_day,
        LumaError::InvalidDay
    );
    require!(
        u64::from(payload.growth_factor_bps) <= crate::constants::BPS_DENOMINATOR,
        LumaError::InvalidGrowthFactor
    );
    require!(
        payload.ph_centi <= MAX_PH_CENTI
            && payload.water_temp_centi_c > -1_000
            && payload.water_temp_centi_c < 10_000
            && payload.market_price_per_kg > 0,
        LumaError::InvalidTelemetryValue
    );
    Ok(())
}
