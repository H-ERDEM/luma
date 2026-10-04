//! Protokol sabitleri: PDA seed'leri, ölçek paydaları ve risk eşikleri.

pub const CONFIG_SEED: &[u8] = b"config";
pub const KYC_SEED: &[u8] = b"kyc";
pub const BATCH_SEED: &[u8] = b"batch";
pub const MINT_SEED: &[u8] = b"mint";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const RESERVE_SEED: &[u8] = b"reserve";

/// Her token tam olarak bir fideyi temsil eder; kesirli fide yoktur.
pub const TOKEN_DECIMALS: u8 = 0;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const GRAMS_PER_KG: u64 = 1_000;

/// Parametrik sigorta eşiği: su sıcaklığı 32.00 °C üzerindeyse kritik arıza.
pub const MAX_WATER_TEMP_CENTI_C: i16 = 3_200;

/// Oracle saatinin zincir saatinin önüne geçebileceği azami süre (saniye).
pub const MAX_CLOCK_DRIFT_SECS: i64 = 60;

/// pH 0–14 aralığı, centi birimiyle.
pub const MAX_PH_CENTI: u16 = 1_400;

/// Ed25519 fallback imzasının alan ayırıcısı (domain separator).
/// İmzalanan mesaj = TELEMETRY_DOMAIN || batch_vault (32 bayt) || borsh(TelemetryPayload).
pub const TELEMETRY_DOMAIN: &[u8] = b"LUMA_TELEMETRY_V1";

/// Ed25519 native program talimat başlığı: num_signatures (1) + padding (1) + 7 x u16 offset.
pub const ED25519_HEADER_LEN: usize = 16;
pub const ED25519_PUBKEY_LEN: usize = 32;
pub const ED25519_SIGNATURE_LEN: usize = 64;
