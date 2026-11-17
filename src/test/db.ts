import { randomUUID } from "node:crypto";

import type { BranchType, Role, TrackingType } from "@/generated/prisma/enums";
import type { Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";

const APP_TABLES = [
  "auth_throttles",
  "audit_logs",
  "notification_logs",
  "stock_alerts",
  "warranty_cards",
  "return_items",
  "returns",
  "trade_ins",
  "invoice_adjustments",
  "customer_payments",
  "installment_schedules",
  "installment_plans",
  "invoice_items",
  "invoices",
  "customers",
  "supplier_payments",
  "stock_transfer_items",
  "stock_transfers",
  "serialized_units",
  "purchase_order_items",
  "purchase_orders",
  "suppliers",
  "branch_inventory",
  "products",
  "message_templates",
  "settings",
  "users",
  "branches",
];

/** Empties every table in the test database. audit_logs blocks TRUNCATE, so its trigger is paused here only. */
export async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("resetDatabase refused: not a _test database");
  await db.$transaction([
    db.$executeRawUnsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_truncate`),
    db.$executeRawUnsafe(`TRUNCATE ${APP_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`),
    db.$executeRawUnsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_truncate`),
  ]);
}

let counter = 0;
const next = () => ++counter;

export async function makeBranch(overrides: { code?: string; name?: string; type?: BranchType } = {}) {
  const n = next();
  return db.branch.create({
    data: {
      code: overrides.code ?? `B${n}`,
      name: overrides.name ?? `Branch ${n}`,
      type: overrides.type ?? "STORE",
      address: "1 Test Street",
      phone: "+2348025550100",
    },
  });
}

export async function makeUser(role: Role, branchId: string | null) {
  const n = next();
  return db.user.create({
    data: { name: `User ${n}`, email: `user${n}-${randomUUID()}@test.local`, passwordHash: "x", role, branchId },
  });
}

export function ctxFor(user: { id: string; role: Role; branchId: string | null }, activeBranchId?: string | null): Ctx {
  return {
    userId: user.id,
    role: user.role,
    branchId: user.branchId,
    activeBranchId: activeBranchId === undefined ? user.branchId : activeBranchId,
  };
}

export async function makeProduct(trackingType: TrackingType, overrides: { reorderLevel?: number } = {}) {
  const n = next();
  return db.product.create({
    data: {
      name: `Product ${n}`,
      brand: "Test",
      category: trackingType === "SERIALIZED" ? "Phones" : "Accessories",
      trackingType,
      sku: `SKU-${n}-${randomUUID().slice(0, 6)}`.toUpperCase(),
      defaultCostPrice: "100.00",
      defaultSellingPrice: "150.00",
      warrantyMonths: 12,
      reorderLevel: overrides.reorderLevel ?? 0,
    },
  });
}

export async function makeSupplier() {
  return db.supplier.create({ data: { name: `Supplier ${next()}` } });
}
