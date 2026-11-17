/**
 * IMEI / serial number parsing for stock intake and scanning. Barcode scanners and pasted lists
 * produce one identifier per line; digit-only 15-character values are IMEIs and must pass the
 * Luhn check, anything else alphanumeric is a manufacturer serial.
 */
export type IdentifierKind = "IMEI" | "SERIAL";

export type IdentifierCheck =
  | { ok: true; kind: IdentifierKind; value: string }
  | { ok: false; value: string; reason: string };

const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,29}$/;
const IMEI_LIKE_LENGTHS = { min: 14, max: 17 };

/** Digit-only input loses spaces and dashes ("35 407115 123456 7"); serials are upper-cased. */
export function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (/^[\d\s-]+$/.test(trimmed)) return trimmed.replace(/[\s-]/g, "");
  return trimmed.toUpperCase().replace(/\s+/g, "");
}

export function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) {
    let digit = Number(value[14 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  }
  return total % 10 === 0;
}

export function checkIdentifier(raw: string): IdentifierCheck {
  const value = normalizeIdentifier(raw);
  if (!value) return { ok: false, value, reason: "Empty line" };
  if (/^\d+$/.test(value)) {
    if (value.length === 15) {
      return isValidImei(value)
        ? { ok: true, kind: "IMEI", value }
        : { ok: false, value, reason: "IMEI check digit is wrong — rescan it" };
    }
    if (value.length >= IMEI_LIKE_LENGTHS.min && value.length <= IMEI_LIKE_LENGTHS.max) {
      return { ok: false, value, reason: "IMEIs have exactly 15 digits" };
    }
  }
  if (SERIAL_PATTERN.test(value)) return { ok: true, kind: "SERIAL", value };
  return { ok: false, value, reason: "Serials are 4–30 letters, digits or dashes" };
}

/** One identifier per line (also accepts commas, semicolons and tabs from spreadsheets). */
export function parseIdentifierList(text: string): string[] {
  return text
    .split(/\r?\n|,|;|\t/)
    .map(normalizeIdentifier)
    .filter((value) => value.length > 0);
}

/** Values that appear more than once. */
export function findDuplicates(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}
