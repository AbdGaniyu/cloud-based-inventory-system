/**
 * RFC 4180 CSV. Text cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) are
 * prefixed with an apostrophe; numbers are passed as numbers so they stay summable.
 */
export type CsvCell = string | number | null;

function cell(value: CsvCell): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
