//! Zincir üstü hesap yapıları.

use anchor_lang::prelude::*;

/// Protokol geneli yapılandırma ve yetki anahtarları.
#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    /// Cüzdanları KYC kaydına onaylayan / reddeden yetki.
    pub kyc_authority: Pubkey,
    /// Birincil oracle yolu: Chainlink DON raporlarını zincire yazan imzacı.
    pub don_authority: Pubkey,
    /// İkincil oracle yolu: backend'in Ed25519 imza anahtarı.
    pub fallback_authority: Pubkey,
    /// Basılan her Token-2022 mint'ine bağlanacak transfer hook programı.
    pub transfer_hook_program: Pubkey,
    /// Kabul edilen tek uzlaşı para birimi (USDC) mint'i.
    pub usdc_mint: Pubkey,
    pub batch_count: u64,
    pub bump: u8,
}

/// Cüzdan başına KYC kaydı. Transfer hook bu hesabı her transferde okur.
#[account]
#[derive(InitSpace)]
pub struct KycRegistry {
    pub wallet: Pubkey,
    pub is_approved: bool,
    pub updated_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BatchStatus {
    Active,
    Defaulted,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum OracleSource {
    None,
    ChainlinkDon,
    AuthorityEd25519,
}

/// Oracle'ın her güncellemede gönderdiği telemetri ve ekonomik girdiler.
/// Tüm parasal değerler mikro-USDC (1 USDC = 1_000_000) cinsindendir.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, InitSpace, Debug)]
pub struct TelemetryPayload {
    /// Tekrar oynatma (replay) koruması için kesin artan sıra numarası.
    pub sequence: u64,
    /// Ölçümün Unix zaman damgası (saniye).
    pub observed_at: i64,
    /// Büyüme döngüsündeki gün (0..=harvest_day).
    pub day: u16,
    /// B_t: biyolojik ilerleme katsayısı, baz puan (0..=10_000).
    pub growth_factor_bps: u16,
    /// Q_est: fide başına beklenen hasat, gram.
    pub est_yield_grams: u32,
    /// P_market: kg başına piyasa fiyatı, mikro-USDC.
    pub market_price_per_kg: u64,
    /// C_rem: fide başına kalan üretim maliyeti, mikro-USDC.
    pub remaining_cost: u64,
    /// RP_t: fide başına risk primi, mikro-USDC.
    pub risk_premium: u64,
    /// Su sıcaklığı, santi-°C (3250 = 32.50 °C).
    pub water_temp_centi_c: i16,
    /// Besin çözeltisi akış hızı, ml/dk. 0 = akış yok.
    pub flow_rate_ml_min: u32,
    /// Elektriksel iletkenlik, µS/cm.
    pub ec_micro_s_cm: u32,
    /// pH, centi birimi (620 = 6.20).
    pub ph_centi: u16,
}

impl TelemetryPayload {
    /// Parametrik sigortanın tetiklenme koşulu.
    pub fn is_critical_failure(&self) -> bool {
        self.water_temp_centi_c > crate::constants::MAX_WATER_TEMP_CENTI_C || self.flow_rate_ml_min == 0
    }
}

/// Tek bir üretim partisinin (batch) durumu ve ekonomik parametreleri.
#[account]
#[derive(InitSpace)]
pub struct BatchVault {
    pub admin: Pubkey,
    pub batch_id: u64,
    pub mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub settlement_escrow: Pubkey,
    pub reserve_vault: Pubkey,
    /// Fide başına ilk satış fiyatı (mikro-USDC). Varsayılan 450_000 = 0.45 USDC.
    pub unit_price: u64,
    pub max_supply: u64,
    pub total_minted: u64,
    pub total_burned: u64,
    pub funding_close_day: u16,
    pub early_exit_day: u16,
    pub harvest_day: u16,
    /// Hasat itfasında adil değerden kesilen protokol payı (625 bps → 0.76 × 0.9375 = 0.7125).
    pub harvest_fee_bps: u16,
    pub max_telemetry_age_secs: i64,
    pub status: BatchStatus,
    pub telemetry: TelemetryPayload,
    pub last_oracle_source: OracleSource,
    pub last_update_ts: i64,
    /// Son hesaplanan FV_t (negatif olabilir), mikro-USDC.
    pub fair_value: i64,
    /// Bonding curve fiyatı = max(FV_t, unit_price), mikro-USDC.
    pub curve_price: u64,
    /// Parametrik temerrüt sonrası token başına iade.
    pub refund_price: u64,
    /// Hasat sonrası token başına itfa.
    pub redemption_price: u64,
    pub bump: u8,
    pub mint_bump: u8,
}

impl BatchVault {
    pub fn circulating_supply(&self) -> u64 {
        self.total_minted.saturating_sub(self.total_burned)
    }
}

/// Anapara teminat kasası. USDC bakiyesi ilişkili ATA'da (escrow_usdc) tutulur.
#[account]
#[derive(InitSpace)]
pub struct SettlementEscrow {
    pub batch_vault: Pubkey,
    pub escrow_usdc: Pubkey,
    pub principal_deposited: u64,
    pub otc_deposited: u64,
    pub total_paid_out: u64,
    pub bump: u8,
}

/// Erken çıkış primlerini karşılayan serbest likidite kasası.
#[account]
#[derive(InitSpace)]
pub struct ReserveVault {
    pub batch_vault: Pubkey,
    pub reserve_usdc: Pubkey,
    pub total_funded: u64,
    pub total_paid_out: u64,
    pub bump: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Backend/istemci tarafındaki `serializeTelemetry` ile bayt bayt aynı olmalıdır
    /// (bkz. backend/src/protocol.ts ve tests/luma.ts içindeki eşleşen vektör).
    #[test]
    fn telemetry_borsh_layout_is_stable() {
        let payload = TelemetryPayload {
            sequence: 7,
            observed_at: 1_700_000_000,
            day: 20,
            growth_factor_bps: 8_500,
            est_yield_grams: 250,
            market_price_per_kg: 3_200_000,
            remaining_cost: 200_000,
            risk_premium: 40_000,
            water_temp_centi_c: -150,
            flow_rate_ml_min: 1_800,
            ec_micro_s_cm: 1_600,
            ph_centi: 610,
        };
        let bytes = payload.try_to_vec().unwrap();
        assert_eq!(bytes.len(), 60);
        let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex,
            "070000000000000000f153650000000014003421fa00000000d4300000000000400d030000000000409c0000000000006aff08070000400600006202"
        );
    }
}
