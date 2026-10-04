/** Cüzdanla imzalanan bir işlemin aşamaları. */
export type TxPhase = null | "preparing" | "signing" | "confirming";

export const PHANTOM_HINT =
  "Onay penceresi açılmadıysa Phantom yan panelini kapatıp tekrar deneyin. Yine de görünmezse tarayıcı araç çubuğundaki Phantom simgesine tıklayın.";

export const CLOSED_BATCH_MESSAGE = "Bu parti kapandı, önce Yeni parti başlat'a basın.";

/** Düğmede gösterilen kısa durum metni. */
export function phaseLabel(phase: TxPhase, fallback = "Çalışıyor…"): string {
  switch (phase) {
    case "preparing":
      return "İşlem hazırlanıyor…";
    case "signing":
      return "Phantom'da onay bekleniyor…";
    case "confirming":
      return "Zincirde onaylanıyor…";
    default:
      return fallback;
  }
}
