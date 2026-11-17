import type { CountryCode } from "libphonenumber-js";

/**
 * Store-wide placeholders. Branch records, VAT rate and bank details are seeded into the database
 * (prisma/seed.ts) and are editable in Settings; the values here are the defaults and the
 * non-editable locale settings.
 */
export const STORE = {
  name: "Gadget Hub",
  currency: "NGN",
  currencySymbol: "₦",
  currencyLocale: "en-NG",
  currencyDecimals: 2,
  /** Percent, as a string so it never passes through a float. */
  defaultVatRatePercent: "7.50",
  defaultPhoneCountry: "NG" satisfies CountryCode as CountryCode,
  /** All due-date and cron logic uses this zone. */
  timezone: "Africa/Lagos",
  /** A serialized unit IN_STOCK for more than this many days raises an aging alert. */
  agingAlertDays: 60,
} as const;
