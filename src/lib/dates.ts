import { STORE } from "@/config/store";
import type { InstallmentFrequency } from "@/generated/prisma/enums";
import { type Money, type MoneyInput, splitEvenly } from "@/lib/money";

/**
 * Calendar-date helpers. Timestamps are stored in UTC; due dates are calendar dates ("YYYY-MM-DD")
 * interpreted in the store timezone (Africa/Lagos). Prisma `@db.Date` columns round-trip as a JS
 * Date at UTC midnight, which toDbDate / fromDbDate convert to and from.
 */
export type CalendarDate = `${number}-${number}-${number}`;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const storeDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parseCalendarDate(value: string): CalendarDate {
  const match = CALENDAR_DATE.exec(value);
  if (!match) throw new RangeError(`Invalid calendar date "${value}"`);
  const [, y, m, d] = match;
  const asUtc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (asUtc.getUTCMonth() !== Number(m) - 1 || asUtc.getUTCDate() !== Number(d)) {
    throw new RangeError(`Invalid calendar date "${value}"`);
  }
  return value as CalendarDate;
}

/** The store-timezone calendar date that `instant` falls on. */
export function calendarDateInStoreTz(instant: Date): CalendarDate {
  // en-CA formats as YYYY-MM-DD.
  return parseCalendarDate(storeDateFormatter.format(instant));
}

export function todayInStoreTz(now: Date = new Date()): CalendarDate {
  return calendarDateInStoreTz(now);
}

/** For writing a `@db.Date` column. */
export function toDbDate(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** For reading a `@db.Date` column. */
export function fromDbDate(date: Date): CalendarDate {
  return parseCalendarDate(date.toISOString().slice(0, 10));
}

function toUtcMidnight(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function fromUtcMidnight(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10) as CalendarDate;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = toUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcMidnight(d);
}

/** Adds calendar months, clamping to the last day of a shorter month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const d = toUtcMidnight(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtcMidnight(target);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtcMidnight(to).getTime() - toUtcMidnight(from).getTime()) / MS_PER_DAY);
}

/**
 * Store-timezone instant for a calendar date and wall-clock time, e.g. the moment a payment was
 * taken at 14:30 Lagos time on a given day.
 */
export function storeInstant(date: CalendarDate, hours = 12, minutes = 0): Date {
  // Find the zone offset at that wall-clock time by comparing the formatted UTC guess.
  const guess = new Date(`${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE.timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

export type ScheduleRow = {
  sequence: number;
  dueDate: CalendarDate;
  amountDue: Money;
};

export function installmentDueDate(
  startDate: CalendarDate,
  frequency: InstallmentFrequency,
  index: number,
): CalendarDate {
  switch (frequency) {
    case "WEEKLY":
      return addDays(startDate, 7 * index);
    case "BI_WEEKLY":
      return addDays(startDate, 14 * index);
    case "MONTHLY":
      // Anchor every row to the start date so month-end clamping never drifts (31 → 28 → 28 ...).
      return addMonths(startDate, index);
  }
}

/**
 * Instalment schedule for a financed amount. The first row is due on `startDate`; the last row
 * absorbs rounding so the rows sum exactly to `financedAmount`.
 */
export function generateInstallmentSchedule(input: {
  financedAmount: MoneyInput;
  numberOfInstallments: number;
  frequency: InstallmentFrequency;
  startDate: CalendarDate;
}): ScheduleRow[] {
  const amounts = splitEvenly(input.financedAmount, input.numberOfInstallments);
  return amounts.map((amountDue, index) => ({
    sequence: index + 1,
    dueDate: installmentDueDate(input.startDate, input.frequency, index),
    amountDue,
  }));
}
