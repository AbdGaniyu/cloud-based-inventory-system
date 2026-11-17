import { type CountryCode, parsePhoneNumberFromString } from "libphonenumber-js";

import { STORE } from "@/config/store";

/**
 * Normalise a phone number to E.164 (e.g. "0803 123 4567" → "+2348031234567").
 * Returns null when the input is not a valid number.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = STORE.defaultPhoneCountry): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function normalizePhoneOrThrow(input: string, defaultCountry?: CountryCode): string {
  const normalized = normalizePhone(input, defaultCountry);
  if (!normalized) throw new RangeError(`Invalid phone number "${input}"`);
  return normalized;
}

/** "+2348025550104" → "+234 802 555 0104" for display; unparseable input is returned unchanged. */
export function formatPhoneDisplay(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
