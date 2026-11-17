import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Ledger and stock integrity checks (scripts/verify-ledger.ts, restore drills, and the daily job):
 * every cached total is recomputed from the rows it summarises, stock is reconciled with transfers
 * and sales, document numbers are checked for gaps, and the safety triggers and CHECK constraints
 * are confirmed present (a careless restore can leave them out). No "server-only": scripts use it.
 */

type Check = { name: string; sql: string };

export const CHECKS: Check[] = [
  {
    name: "Invoice amount paid matches its payments",
    sql: `SELECT i.number, i.amount_paid, COALESCE(SUM(p.amount), 0) AS from_rows
          FROM invoices i LEFT JOIN customer_payments p ON p.invoice_id = i.id
          GROUP BY i.id HAVING i.amount_paid <> COALESCE(SUM(p.amount), 0)`,
  },
  {
    name: "Invoice returned amount matches its returns",
    sql: `SELECT i.number, i.returned_amount, COALESCE(SUM(r.credit_amount), 0) AS from_rows
          FROM invoices i LEFT JOIN returns r ON r.invoice_id = i.id
          GROUP BY i.id HAVING i.returned_amount <> COALESCE(SUM(r.credit_amount), 0)`,
  },
  {
    name: "Invoice adjusted amount matches its waivers",
    sql: `SELECT i.number, i.adjusted_amount, COALESCE(SUM(a.amount), 0) AS from_rows
          FROM invoices i LEFT JOIN invoice_adjustments a ON a.invoice_id = i.id
          GROUP BY i.id HAVING i.adjusted_amount <> COALESCE(SUM(a.amount), 0)`,
  },
  {
    name: "Invoice balance = total − returned − adjusted − paid",
    sql: `SELECT number, balance FROM invoices WHERE balance <> total - returned_amount - adjusted_amount - amount_paid`,
  },
  {
    name: "Purchase order amount paid matches its supplier payments",
    sql: `SELECT po.number, po.amount_paid, COALESCE(SUM(sp.amount), 0) AS from_rows
          FROM purchase_orders po LEFT JOIN supplier_payments sp ON sp.purchase_order_id = po.id
          GROUP BY po.id HAVING po.amount_paid <> COALESCE(SUM(sp.amount), 0)`,
  },
  {
    name: "Instalment schedule adds up to the amount financed",
    sql: `SELECT i.number, pl.financed_amount, SUM(s.amount_due) AS scheduled
          FROM installment_plans pl JOIN invoices i ON i.id = pl.invoice_id JOIN installment_schedules s ON s.plan_id = pl.id
          GROUP BY i.number, pl.financed_amount HAVING SUM(s.amount_due) <> pl.financed_amount`,
  },
  {
    name: "No negative shelf or in-transit quantities",
    sql: `SELECT product_id, branch_id, quantity, reserved_quantity FROM branch_inventory WHERE quantity < 0 OR reserved_quantity < 0`,
  },
  {
    name: "In-transit accessory quantities match open transfers",
    sql: `SELECT bi.product_id, bi.branch_id, bi.reserved_quantity, COALESCE(t.qty, 0) AS on_transfers
          FROM branch_inventory bi
          LEFT JOIN (
            SELECT st.from_branch_id AS branch_id, sti.product_id, SUM(sti.quantity) AS qty
            FROM stock_transfer_items sti JOIN stock_transfers st ON st.id = sti.transfer_id
            WHERE st.status = 'IN_TRANSIT' AND sti.serialized_unit_id IS NULL
            GROUP BY 1, 2
          ) t ON t.branch_id = bi.branch_id AND t.product_id = bi.product_id
          WHERE bi.reserved_quantity <> COALESCE(t.qty, 0)`,
  },
  {
    name: "Every sold device is on a live invoice",
    sql: `SELECT u.id, COALESCE(u.imei, u.serial_number) AS identifier FROM serialized_units u
          WHERE u.status = 'SOLD' AND NOT EXISTS (
            SELECT 1 FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
            WHERE it.serialized_unit_id = u.id AND i.status <> 'VOID')`,
  },
  {
    name: "Every in-transit device is on an open transfer",
    sql: `SELECT u.id, COALESCE(u.imei, u.serial_number) AS identifier FROM serialized_units u
          WHERE u.status = 'IN_TRANSIT' AND NOT EXISTS (
            SELECT 1 FROM stock_transfer_items sti JOIN stock_transfers st ON st.id = sti.transfer_id
            WHERE sti.serialized_unit_id = u.id AND st.status = 'IN_TRANSIT')`,
  },
  {
    name: "Invoice numbers are gapless per branch",
    // Grouped by the series in the number (INV-<code>-n), not the current branch: closing a branch moves
    // its open invoices to another branch but they keep their numbers.
    sql: `SELECT s.code, b.invoice_sequence, s.invoices, s.highest
          FROM (
            SELECT split_part(number, '-', 2) AS code, COUNT(*) AS invoices, MAX(CAST(split_part(number, '-', 3) AS int)) AS highest
            FROM invoices WHERE number LIKE 'INV-%' GROUP BY 1
          ) s LEFT JOIN branches b ON b.code = s.code
          WHERE s.invoices <> s.highest OR b.invoice_sequence IS NULL OR b.invoice_sequence < s.highest`,
  },
  {
    name: "Safety triggers are installed",
    sql: `SELECT name FROM (VALUES ('audit_logs_no_update_delete'), ('audit_logs_no_truncate'), ('stock_adjustments_no_update_delete'), ('cash_ups_guard')) AS t(name)
          WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t.name AND NOT tgisinternal)`,
  },
  {
    name: "Ledger CHECK constraints are installed",
    sql: `SELECT name FROM (VALUES ('invoices_balance_reconciles_check'), ('invoices_void_has_reason_check'), ('stock_adjustments_shape_check'), ('cash_ups_variance_check')) AS t(name)
          WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t.name)`,
  },
];

const SAMPLE = 5;

export type IntegrityResult = { name: string; problems: number; sample: Record<string, unknown>[] };

export async function runIntegrityChecks(client: Pick<PrismaClient, "$queryRawUnsafe">): Promise<IntegrityResult[]> {
  const results: IntegrityResult[] = [];
  for (const check of CHECKS) {
    const rows = await client.$queryRawUnsafe<Record<string, unknown>[]>(check.sql);
    // BigInt counts don't survive JSON (alerts, logs).
    const sample = rows.slice(0, SAMPLE).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    results.push({ name: check.name, problems: rows.length, sample });
  }
  return results;
}
