import { z } from "zod";

import { parseCalendarDate } from "@/lib/dates";

/** Money typed by a person: up to 12 digits, optional kobo. Kept as a string — never a float. */
export const moneyString = z
  .string()
  .trim()
  .transform((value) => value.replace(/,/g, ""))
  .pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 1250000 or 1250000.50"));

export const calendarDateString = z.string().refine((value) => {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}, "Enter a valid date");

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();

/** Optional money: a blank field means "not provided". */
export const optionalMoneyString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(moneyString.optional())
  .optional();
