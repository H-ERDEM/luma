use anchor_lang::prelude::*;

#[error_code]
pub enum LumaError {
    #[msg("Cüzdan KYC kaydında onaylı değil")]
    KycNotApproved,
    #[msg("Bu işlem için yetkiniz yok")]
    Unauthorized,
    #[msg("Oracle güncellemesi ne Chainlink DON ne de Ed25519 fallback yetkisiyle doğrulandı")]
    UnauthorizedOracle,
    #[msg("Önceki talimat geçerli bir Ed25519 doğrulama talimatı değil")]
    InvalidEd25519Instruction,
    #[msg("Ed25519 imzacısı yapılandırılmış fallback yetkisi değil")]
    Ed25519AuthorityMismatch,
    #[msg("Ed25519 ile imzalanan mesaj telemetri yüküyle eşleşmiyor")]
    Ed25519MessageMismatch,
    #[msg("Telemetri sıra numarası son kayıttan büyük olmalı")]
    StaleSequence,
    #[msg("Telemetri verisi çok eski")]
    StaleTelemetry,
    #[msg("Telemetri zaman damgası zincir saatinin ilerisinde")]
    TelemetryFromFuture,
    #[msg("Büyüme günü geriye gidemez veya hasat gününü aşamaz")]
    InvalidDay,
    #[msg("Büyüme katsayısı B_t 0 ile 10000 bps arasında olmalı")]
    InvalidGrowthFactor,
    #[msg("Telemetri sensör değeri fiziksel aralığın dışında")]
    InvalidTelemetryValue,
    #[msg("Escrow kasasında yeterli USDC likiditesi yok")]
    InsufficientEscrowLiquidity,
    #[msg("Erken çıkış primi için rezerv likiditesi yetersiz")]
    InsufficientExitLiquidity,
    #[msg("Solvency invariantı ihlal edildi: escrow < dolaşımdaki token × ilk birim fiyat")]
    SolvencyInvariantViolated,
    #[msg("Parti aktif değil")]
    BatchNotActive,
    #[msg("Parti temerrüt durumunda değil")]
    BatchNotDefaulted,
    #[msg("Parti hasat uzlaşmasını tamamlamadı")]
    BatchNotSettled,
    #[msg("Fonlama penceresi kapandı")]
    FundingClosed,
    #[msg("Erken çıkış penceresi henüz açılmadı")]
    EarlyExitNotOpen,
    #[msg("Hasat günü geldi; erken çıkış yerine itfa kullanılmalı")]
    EarlyExitClosed,
    #[msg("Hasat günü henüz gelmedi")]
    HarvestNotReached,
    #[msg("Son telemetride kritik arıza koşulu yok")]
    NoDefaultCondition,
    #[msg("Son telemetri kritik arıza bildiriyor; önce parametrik temerrüt tetiklenmeli")]
    CriticalFailurePending,
    #[msg("Henüz hiç telemetri kaydedilmedi")]
    NoTelemetry,
    #[msg("Azami arz aşıldı")]
    MaxSupplyExceeded,
    #[msg("Miktar sıfırdan büyük olmalı")]
    ZeroAmount,
    #[msg("Ödeme kabul edilen minimum tutarın altında (slippage)")]
    SlippageExceeded,
    #[msg("Aritmetik taşma")]
    MathOverflow,
    #[msg("Geçersiz parti parametreleri")]
    InvalidBatchParams,
    #[msg("Geçersiz yetki anahtarı")]
    InvalidAuthority,
}
