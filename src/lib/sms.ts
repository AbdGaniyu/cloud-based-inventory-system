/** GSM 03.38 basic set; anything outside it (₦, emoji, smart quotes) forces UCS-2. */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
/** Escape-coded characters that take two septets. */
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

/** Characters and billed SMS parts for a message (single 160/70, multipart 153/67 per part). */
export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; characters: number; segments: number } {
  const chars = [...text];
  const gsm = chars.every((c) => GSM_BASIC.has(c) || GSM_EXTENDED.has(c));
  if (gsm) {
    const septets = chars.reduce((n, c) => n + (GSM_EXTENDED.has(c) ? 2 : 1), 0);
    return { encoding: "GSM-7", characters: septets, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  }
  const units = text.length;
  return { encoding: "UCS-2", characters: units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
