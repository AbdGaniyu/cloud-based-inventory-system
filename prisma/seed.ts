/**
 * Development seed. Idempotent: every seeded row has a deterministic ID; reference data is created
 * only when missing, and each business scenario (PO, transfer, sale) runs in its own transaction
 * that is skipped when its anchor record already exists. Run with `pnpm db:seed`.
 *
 * Dates are relative to "today" in Africa/Lagos so overdue / upcoming scenarios stay meaningful.
 */
import "dotenv/config";

import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";

import type {
  InstallmentFrequency,
  PaymentMethod,
  PaymentTerms,
  Prisma,
  PrismaClient,
  Role,
  UnitCondition,
} from "@/generated/prisma/client";
import {
  addDays,
  addMonths,
  type CalendarDate,
  generateInstallmentSchedule,
  storeInstant,
  toDbDate,
  todayInStoreTz,
} from "@/lib/dates";
import { randomPublicId } from "@/lib/ids";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import { nextDocumentNumber } from "@/lib/invoice-number";
import { type Money, money, sum, toDb } from "@/lib/money";
import { normalizePhoneOrThrow } from "@/lib/phone";
import { createPrismaClient } from "@/server/db";
import { writeAudit } from "@/server/services/audit.service";

type Tx = Prisma.TransactionClient;

const DEFAULT_SEED_PASSWORD = "GadgetHub!2026";
const BCRYPT_COST = 12;
const TX_OPTIONS = { timeout: 30_000 };

// ─── Deterministic IDs ───────────────────────────────────────────────────────

/** Stable UUID (RFC 9562 version 8, "custom") derived from a seed key. */
function seedId(key: string): string {
  const h = createHash("sha256").update(`gadget-hub-seed:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function luhnCheckDigit(digits: string): string {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return String((10 - (total % 10)) % 10);
}

/** Valid 15-digit IMEI: 8-digit TAC + 6-digit serial + Luhn check digit. */
function imei(tac: string, serial: number): string {
  const body = `${tac}${String(serial).padStart(6, "0")}`;
  return body + luhnCheckDigit(body);
}

// ─── Time ────────────────────────────────────────────────────────────────────

const TODAY = todayInStoreTz();
const daysAgo = (n: number): CalendarDate => addDays(TODAY, -n);
/** Instant `n` days ago at the given Lagos wall-clock time. */
const at = (n: number, hours = 11, minutes = 0): Date => storeInstant(daysAgo(n), hours, minutes);

// ─── Reference data ──────────────────────────────────────────────────────────

const BRANCHES = [
  {
    code: "MAIN",
    name: "Main Branch",
    type: "STORE",
    address: "5, Pepple Street, Computer Village, Ikeja",
    phone: "+234 905 870 6999",
    email: "info@leeplugshub.com",
  },
  {
    code: "IKJ",
    name: "Ikeja",
    type: "STORE",
    address: "14 Allen Avenue, Ikeja, Lagos",
    phone: "0802 555 0102",
    email: "ikeja@gadgethub.test",
  },
  {
    code: "LEK",
    name: "Lekki",
    type: "STORE",
    address: "Plot 9, Admiralty Way, Lekki Phase 1, Lagos",
    phone: "0802 555 0103",
    email: "lekki@gadgethub.test",
  },
  {
    code: "WH",
    name: "Central Warehouse",
    type: "WAREHOUSE",
    address: "Plot 7, Oregun Industrial Estate, Ikeja, Lagos",
    phone: "0802 555 0104",
    email: "warehouse@gadgethub.test",
  },
] as const;

type BranchCode = (typeof BRANCHES)[number]["code"];

const USERS: { key: string; name: string; email: string; role: Role; branch: BranchCode | null }[] = [
  { key: "owner", name: "Kemi Adebayo", email: "owner@gadgethub.test", role: "OWNER", branch: null },
  { key: "manager.MAIN", name: "Emeka Obi", email: "manager.main@gadgethub.test", role: "BRANCH_MANAGER", branch: "MAIN" },
  { key: "cashier.MAIN", name: "Ada Nwosu", email: "cashier.main@gadgethub.test", role: "CASHIER", branch: "MAIN" },
  { key: "manager.IKJ", name: "Bola Hassan", email: "manager.ikj@gadgethub.test", role: "BRANCH_MANAGER", branch: "IKJ" },
  { key: "cashier.IKJ", name: "Femi Johnson", email: "cashier.ikj@gadgethub.test", role: "CASHIER", branch: "IKJ" },
  { key: "manager.LEK", name: "Seyi Lawal", email: "manager.lek@gadgethub.test", role: "BRANCH_MANAGER", branch: "LEK" },
  { key: "cashier.LEK", name: "Halima Bello", email: "cashier.lek@gadgethub.test", role: "CASHIER", branch: "LEK" },
];

const PRODUCTS = {
  iphone15pro: {
    name: "Apple iPhone 15 Pro 256GB",
    brand: "Apple",
    category: "Phones",
    trackingType: "SERIALIZED",
    sku: "PH-APL-IP15P-256",
    barcode: "0195949038372",
    cost: "1150000",
    price: "1350000",
    warrantyMonths: 12,
    reorderLevel: 2,
  },
  s24ultra: {
    name: "Samsung Galaxy S24 Ultra 256GB",
    brand: "Samsung",
    category: "Phones",
    trackingType: "SERIALIZED",
    sku: "PH-SAM-S24U-256",
    barcode: "8806095299549",
    cost: "1050000",
    price: "1250000",
    warrantyMonths: 12,
    reorderLevel: 2,
  },
  iphone13: {
    name: "Apple iPhone 13 128GB",
    brand: "Apple",
    category: "Phones",
    trackingType: "SERIALIZED",
    sku: "PH-APL-IP13-128",
    barcode: "0194252707500",
    cost: "420000",
    price: "520000",
    warrantyMonths: 3,
    reorderLevel: 2,
  },
  iphone11: {
    name: "Apple iPhone 11 64GB",
    brand: "Apple",
    category: "Phones",
    trackingType: "SERIALIZED",
    sku: "PH-APL-IP11-64",
    barcode: "0190199220454",
    cost: "150000",
    price: "230000",
    warrantyMonths: 3,
    reorderLevel: 0,
  },
  macbookAir: {
    name: 'Apple MacBook Air 13" M3 16GB/512GB',
    brand: "Apple",
    category: "Laptops",
    trackingType: "SERIALIZED",
    sku: "LP-APL-MBA13-M3-512",
    barcode: "0195949186004",
    cost: "1480000",
    price: "1750000",
    warrantyMonths: 12,
    reorderLevel: 1,
  },
  elitebook: {
    name: "HP EliteBook 840 G8 i7 16GB/512GB",
    brand: "HP",
    category: "Laptops",
    trackingType: "SERIALIZED",
    sku: "LP-HP-EB840G8-512",
    barcode: null,
    cost: "520000",
    price: "650000",
    warrantyMonths: 6,
    reorderLevel: 1,
  },
  ps5: {
    name: "Sony PlayStation 5 Slim 1TB",
    brand: "Sony",
    category: "Consoles",
    trackingType: "SERIALIZED",
    sku: "CN-SNY-PS5S-1TB",
    barcode: "0711719577218",
    cost: "690000",
    price: "820000",
    warrantyMonths: 12,
    reorderLevel: 1,
  },
  watch9: {
    name: "Apple Watch Series 9 45mm GPS",
    brand: "Apple",
    category: "Smartwatches",
    trackingType: "SERIALIZED",
    sku: "SW-APL-AW9-45",
    barcode: "0195949005558",
    cost: "480000",
    price: "580000",
    warrantyMonths: 12,
    reorderLevel: 1,
  },
  charger: {
    name: "Anker 20W USB-C Charger",
    brand: "Anker",
    category: "Accessories",
    trackingType: "NON_SERIALIZED",
    sku: "AC-ANK-20W-USBC",
    barcode: "0194644098728",
    cost: "9500",
    price: "15000",
    warrantyMonths: 3,
    reorderLevel: 10,
  },
  earbuds: {
    name: "Oraimo FreePods 4 Earbuds",
    brand: "Oraimo",
    category: "Accessories",
    trackingType: "NON_SERIALIZED",
    sku: "AC-ORM-FP4",
    barcode: "6941409111246",
    cost: "18000",
    price: "27000",
    warrantyMonths: 6,
    reorderLevel: 8,
  },
  cable: {
    name: "USB-C to Lightning Cable 1m",
    brand: "Generic",
    category: "Accessories",
    trackingType: "NON_SERIALIZED",
    sku: "AC-GEN-USBC-LTG-1M",
    barcode: "6970000000014",
    cost: "3500",
    price: "7000",
    warrantyMonths: 0,
    reorderLevel: 15,
  },
  protector: {
    name: "Tempered Glass Screen Protector",
    brand: "Generic",
    category: "Accessories",
    trackingType: "NON_SERIALIZED",
    sku: "AC-GEN-TGLASS",
    barcode: "6970000000021",
    cost: "1200",
    price: "3500",
    warrantyMonths: 0,
    reorderLevel: 20,
  },
} as const;

type ProductKey = keyof typeof PRODUCTS;

const TAC: Partial<Record<ProductKey, string>> = {
  iphone15pro: "35407115",
  s24ultra: "35118035",
  iphone13: "35392611",
  iphone11: "35391110",
};

const SUPPLIERS = {
  apex: {
    name: "Apex Gadgets Distribution Ltd",
    contactPerson: "Chinedu Okeke",
    phone: "0809 222 3344",
    email: "sales@apexgadgets.test",
    address: "Computer Village, Ikeja, Lagos",
  },
  lagosTech: {
    name: "Lagos Tech Wholesale",
    contactPerson: "Yusuf Danjuma",
    phone: "0818 444 5566",
    email: "orders@lagostech.test",
    address: "Alaba International Market, Ojo, Lagos",
  },
} as const;

const CUSTOMERS = {
  adaeze: { name: "Adaeze Okafor", phone: "0803 123 4567", email: "adaeze@example.com", whatsapp: true, sms: true },
  tunde: { name: "Tunde Bakare", phone: "0805 234 5678", email: null, whatsapp: true, sms: true },
  chioma: { name: "Chioma Eze", phone: "0706 345 6789", email: "chioma.eze@example.com", whatsapp: true, sms: true },
  ibrahim: { name: "Ibrahim Musa", phone: "0812 456 7890", email: null, whatsapp: true, sms: true },
  funmi: { name: "Funmi Adeyemi", phone: "0909 567 8901", email: null, whatsapp: false, sms: true },
} as const;

type CustomerKey = keyof typeof CUSTOMERS;

const WARRANTY_TERMS =
  "Covers manufacturing defects for the period shown. Excludes physical damage, liquid damage, " +
  "unauthorised repairs and software issues. Present this card or its QR code at any LeePlugsHub branch.";

const PAYMENT_INSTRUCTIONS = "Pay at any LeePlugsHub branch or transfer to Zenith Bank 1012345678 (LeePlugsHub).";

const TEMPLATES: {
  key: string;
  name: string;
  body: string;
  smsBody: string;
  whatsappTemplateName: string;
}[] = [
  {
    key: "receipt",
    name: "Receipt",
    body: "Hi {{customer_name}}, thank you for shopping at LeePlugsHub {{branch_name}}. Invoice {{invoice_number}}: {{invoice_total}}. Your receipt is attached.",
    smsBody: "LeePlugsHub: thanks {{customer_name}}! Invoice {{invoice_number}} {{invoice_total}}. Receipt: {{document_link}}",
    whatsappTemplateName: "gh_receipt",
  },
  {
    key: "warranty_card",
    name: "Warranty card",
    body: "Hi {{customer_name}}, your {{device_name}} ({{serial_masked}}) is under warranty until {{warranty_expiry}}. Your warranty card is attached. Verify anytime: {{warranty_link}}",
    smsBody: "LeePlugsHub: {{device_name}} warranty valid to {{warranty_expiry}}. Card: {{warranty_link}}",
    whatsappTemplateName: "gh_warranty_card",
  },
  {
    key: "installment_due_3d",
    name: "Instalment due in 3 days",
    body: "Hi {{customer_name}}, a friendly reminder that {{amount_due}} on invoice {{invoice_number}} is due on {{due_date}}. Balance remaining: {{balance_remaining}}. {{payment_instructions}}",
    smsBody: "LeePlugsHub: {{amount_due}} due {{due_date}} on {{invoice_number}}. Bal {{balance_remaining}}. {{payment_instructions}}",
    whatsappTemplateName: "gh_installment_due_3d",
  },
  {
    key: "installment_due_today",
    name: "Instalment due today",
    body: "Hi {{customer_name}}, your instalment of {{amount_due}} on invoice {{invoice_number}} is due today. Balance remaining: {{balance_remaining}}. {{payment_instructions}}",
    smsBody: "LeePlugsHub: {{amount_due}} due TODAY on {{invoice_number}}. Bal {{balance_remaining}}. {{payment_instructions}}",
    whatsappTemplateName: "gh_installment_due_today",
  },
  {
    key: "installment_overdue_1d",
    name: "Instalment 1 day overdue",
    body: "Hi {{customer_name}}, your instalment of {{amount_due}} on invoice {{invoice_number}} was due yesterday ({{due_date}}). Please pay as soon as you can. {{payment_instructions}}",
    smsBody: "LeePlugsHub: {{amount_due}} on {{invoice_number}} was due {{due_date}}. Please pay. {{payment_instructions}}",
    whatsappTemplateName: "gh_installment_overdue_1d",
  },
  {
    key: "installment_overdue_7d",
    name: "Instalment 7 days overdue",
    body: "Hi {{customer_name}}, your instalment of {{amount_due}} on invoice {{invoice_number}} is now 7 days overdue (due {{due_date}}). Balance remaining: {{balance_remaining}}. Please contact {{branch_name}} or pay now. {{payment_instructions}}",
    smsBody: "LeePlugsHub: {{amount_due}} on {{invoice_number}} is 7 days overdue. Bal {{balance_remaining}}. {{payment_instructions}}",
    whatsappTemplateName: "gh_installment_overdue_7d",
  },
  {
    key: "installment_overdue_14d",
    name: "Instalment 14 days overdue",
    body: "Hi {{customer_name}}, your instalment of {{amount_due}} on invoice {{invoice_number}} is 14 days overdue. Your account will be reviewed by management. Please pay or call {{branch_name}} today. {{payment_instructions}}",
    smsBody: "LeePlugsHub: {{invoice_number}} is 14 days overdue ({{amount_due}}). Please pay or call us today.",
    whatsappTemplateName: "gh_installment_overdue_14d",
  },
  {
    key: "payment_confirmation",
    name: "Payment confirmation",
    body: "Hi {{customer_name}}, we have received {{amount_paid}} for invoice {{invoice_number}} at {{branch_name}}. Balance remaining: {{balance_remaining}}. Thank you!",
    smsBody: "LeePlugsHub: received {{amount_paid}} for {{invoice_number}}. Bal {{balance_remaining}}. Thank you!",
    whatsappTemplateName: "gh_payment_confirmation",
  },
  {
    key: "manual_reminder",
    name: "Manual reminder",
    body: "Hi {{customer_name}}, this is a reminder from LeePlugsHub {{branch_name}} about invoice {{invoice_number}}. Balance remaining: {{balance_remaining}}. {{payment_instructions}}",
    smsBody: "LeePlugsHub: reminder for {{invoice_number}}. Bal {{balance_remaining}}. {{payment_instructions}}",
    whatsappTemplateName: "gh_manual_reminder",
  },
];

const SETTINGS: { key: string; value: Prisma.InputJsonValue }[] = [
  { key: "store.name", value: "LeePlugsHub" },
  { key: "tax.vatRatePercent", value: "7.50" },
  { key: "installments.approvalThreshold", value: "1000000.00" },
  { key: "installments.minDownPaymentPercent", value: "30" },
  {
    key: "payments.bankDetails",
    value: { bankName: "Zenith Bank", accountName: "LeePlugsHub", accountNumber: "1012345678" },
  },
  { key: "payments.instructions", value: PAYMENT_INSTRUCTIONS },
  { key: "alerts.agingDays", value: 60 },
  { key: "notifications.maxAttempts", value: 3 },
  { key: "warranty.defaultTerms", value: WARRANTY_TERMS },
];

// ─── Seeding context ─────────────────────────────────────────────────────────

type Ctx = {
  db: PrismaClient;
  branch: Record<BranchCode, { id: string; name: string }>;
  user: Record<string, string>;
  product: Record<ProductKey, string>;
  supplier: Record<keyof typeof SUPPLIERS, string>;
  customer: Record<CustomerKey, string>;
};

async function seedReferenceData(db: PrismaClient, passwordHash: string): Promise<Ctx> {
  const branch = {} as Ctx["branch"];
  for (const b of BRANCHES) {
    const row = await db.branch.upsert({
      where: { code: b.code },
      create: {
        id: seedId(`branch:${b.code}`),
        code: b.code,
        name: b.name,
        type: b.type,
        address: b.address,
        phone: normalizePhoneOrThrow(b.phone),
        email: b.email,
      },
      update: {},
      select: { id: true, name: true },
    });
    branch[b.code] = row;
  }

  const user: Ctx["user"] = {};
  for (const u of USERS) {
    const row = await db.user.upsert({
      where: { email: u.email },
      create: {
        id: seedId(`user:${u.key}`),
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
        branchId: u.branch ? branch[u.branch].id : null,
      },
      update: {},
      select: { id: true },
    });
    user[u.key] = row.id;
  }

  const product = {} as Ctx["product"];
  for (const [key, p] of Object.entries(PRODUCTS) as [ProductKey, (typeof PRODUCTS)[ProductKey]][]) {
    const row = await db.product.upsert({
      where: { sku: p.sku },
      create: {
        id: seedId(`product:${key}`),
        name: p.name,
        brand: p.brand,
        category: p.category,
        trackingType: p.trackingType,
        sku: p.sku,
        barcode: p.barcode,
        defaultCostPrice: toDb(p.cost),
        defaultSellingPrice: toDb(p.price),
        warrantyMonths: p.warrantyMonths,
        reorderLevel: p.reorderLevel,
      },
      update: {},
      select: { id: true },
    });
    product[key] = row.id;
  }

  const supplier = {} as Ctx["supplier"];
  for (const [key, s] of Object.entries(SUPPLIERS) as [keyof typeof SUPPLIERS, (typeof SUPPLIERS)[keyof typeof SUPPLIERS]][]) {
    const id = seedId(`supplier:${key}`);
    await db.supplier.upsert({
      where: { id },
      create: { id, ...s, phone: normalizePhoneOrThrow(s.phone) },
      update: {},
    });
    supplier[key] = id;
  }

  const customer = {} as Ctx["customer"];
  for (const [key, c] of Object.entries(CUSTOMERS) as [CustomerKey, (typeof CUSTOMERS)[CustomerKey]][]) {
    const phoneE164 = normalizePhoneOrThrow(c.phone);
    const row = await db.customer.upsert({
      where: { phoneE164 },
      create: {
        id: seedId(`customer:${key}`),
        name: c.name,
        phoneE164,
        email: c.email,
        whatsappOptIn: c.whatsapp,
        smsOptIn: c.sms,
        createdById: user["cashier.IKJ"],
      },
      update: {},
      select: { id: true },
    });
    customer[key] = row.id;
  }

  for (const t of TEMPLATES) {
    await db.messageTemplate.upsert({
      where: { key: t.key },
      create: { id: seedId(`template:${t.key}`), ...t },
      update: {},
    });
  }

  for (const s of SETTINGS) {
    await db.setting.upsert({
      where: { key: s.key },
      create: { id: seedId(`setting:${s.key}`), key: s.key, value: s.value },
      update: {},
    });
  }

  return { db, branch, user, product, supplier, customer };
}

// ─── Scenario helpers ────────────────────────────────────────────────────────

/** Runs a scenario once: skipped when its anchor row already exists. */
async function once(
  label: string,
  exists: () => Promise<unknown>,
  run: () => Promise<void>,
  log: string[],
): Promise<void> {
  if (await exists()) {
    log.push(`  · ${label} — already seeded`);
    return;
  }
  await run();
  log.push(`  ✓ ${label}`);
}

async function addStock(tx: Tx, branchId: string, productId: string, quantity: number): Promise<void> {
  await tx.branchInventory.upsert({
    where: { productId_branchId: { productId, branchId } },
    create: { productId, branchId, quantity },
    update: { quantity: { increment: quantity } },
  });
}

type UnitSpec = {
  key: string;
  product: ProductKey;
  condition: UnitCondition;
  color?: string;
  storage?: string;
  ram?: string;
  batteryHealth?: number;
  cost?: string;
  price?: string;
  serialNumber?: string;
};

type AccessoryLine = { product: ProductKey; quantity: number };

/** Identifiers derive from the unit key, so they are stable no matter which scenarios already ran. */
function unitIdentifiers(spec: UnitSpec): { imei: string | null; serialNumber: string | null } {
  const tac = TAC[spec.product];
  if (tac) {
    const serial = parseInt(createHash("sha256").update(`imei:${spec.key}`).digest("hex").slice(0, 8), 16) % 1_000_000;
    return { imei: imei(tac, serial), serialNumber: spec.serialNumber ?? null };
  }
  if (!spec.serialNumber) throw new Error(`Unit ${spec.key} needs a serial number`);
  return { imei: null, serialNumber: spec.serialNumber };
}

async function createPurchaseOrder(
  ctx: Ctx,
  input: {
    key: string;
    supplier: keyof typeof SUPPLIERS;
    branch: BranchCode;
    terms: PaymentTerms;
    receivedDaysAgo: number;
    dueDaysAfterReceipt: number | null;
    supplierReference: string;
    units: UnitSpec[];
    accessories: AccessoryLine[];
    payments: { daysAgo: number; amount: "FULL" | string; method: PaymentMethod; reference: string }[];
  },
): Promise<void> {
  const receivedById = ctx.user.owner;
  const receivedAt = at(input.receivedDaysAgo, 10);
  const branchId = ctx.branch[input.branch].id;
  const poId = seedId(`po:${input.key}`);

  await ctx.db.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, branchId, "PURCHASE_ORDER");

    // Serialized lines grouped by (product, unit cost) so unitCost is exact.
    const groups = new Map<string, { product: ProductKey; cost: Money; price: Money; units: UnitSpec[] }>();
    for (const u of input.units) {
      const cost = money(u.cost ?? PRODUCTS[u.product].cost);
      const price = money(u.price ?? PRODUCTS[u.product].price);
      const groupKey = `${u.product}:${cost.toFixed(2)}`;
      const g = groups.get(groupKey) ?? { product: u.product, cost, price, units: [] };
      g.units.push(u);
      groups.set(groupKey, g);
    }

    const lineTotals: Money[] = [];
    const itemRows: Prisma.PurchaseOrderItemCreateManyInput[] = [];
    const unitRows: Prisma.SerializedUnitCreateManyInput[] = [];

    for (const [groupKey, g] of groups) {
      const itemId = seedId(`po-item:${input.key}:${groupKey}`);
      const lineTotal = g.cost.times(g.units.length);
      lineTotals.push(lineTotal);
      itemRows.push({
        id: itemId,
        purchaseOrderId: poId,
        productId: ctx.product[g.product],
        quantity: g.units.length,
        unitCost: toDb(g.cost),
        unitSellingPrice: toDb(g.price),
        lineTotal: toDb(lineTotal),
      });
      for (const u of g.units) {
        unitRows.push({
          id: seedId(`unit:${u.key}`),
          productId: ctx.product[u.product],
          ...unitIdentifiers(u),
          branchId,
          condition: u.condition,
          color: u.color ?? null,
          storage: u.storage ?? null,
          ram: u.ram ?? null,
          batteryHealth: u.batteryHealth ?? null,
          costPrice: toDb(u.cost ?? PRODUCTS[u.product].cost),
          sellingPrice: toDb(u.price ?? PRODUCTS[u.product].price),
          status: "IN_STOCK",
          purchaseOrderId: poId,
          purchaseOrderItemId: itemId,
          receivedAt,
          createdAt: receivedAt,
        });
      }
    }

    for (const a of input.accessories) {
      const p = PRODUCTS[a.product];
      const lineTotal = money(p.cost).times(a.quantity);
      lineTotals.push(lineTotal);
      itemRows.push({
        id: seedId(`po-item:${input.key}:${a.product}`),
        purchaseOrderId: poId,
        productId: ctx.product[a.product],
        quantity: a.quantity,
        unitCost: toDb(p.cost),
        unitSellingPrice: toDb(p.price),
        lineTotal: toDb(lineTotal),
      });
    }

    const totalCost = sum(lineTotals);
    const paymentAmounts = input.payments.map((p) => (p.amount === "FULL" ? totalCost : money(p.amount)));
    const amountPaid = sum(paymentAmounts);
    const status = amountPaid.isZero() ? "UNPAID" : amountPaid.equals(totalCost) ? "PAID" : "PARTIALLY_PAID";

    await tx.purchaseOrder.create({
      data: {
        id: poId,
        number,
        supplierId: ctx.supplier[input.supplier],
        branchId,
        paymentTerms: input.terms,
        supplierReference: input.supplierReference,
        totalCost: toDb(totalCost),
        amountPaid: toDb(amountPaid),
        dueDate:
          input.dueDaysAfterReceipt === null
            ? null
            : toDbDate(addDays(daysAgo(input.receivedDaysAgo), input.dueDaysAfterReceipt)),
        status,
        receivedById,
        receivedAt,
        createdAt: receivedAt,
      },
    });
    await tx.purchaseOrderItem.createMany({ data: itemRows });
    await tx.serializedUnit.createMany({ data: unitRows });
    for (const a of input.accessories) await addStock(tx, branchId, ctx.product[a.product], a.quantity);

    for (const [i, p] of input.payments.entries()) {
      const paymentId = seedId(`supplier-payment:${input.key}:${i}`);
      await tx.supplierPayment.create({
        data: {
          id: paymentId,
          purchaseOrderId: poId,
          supplierId: ctx.supplier[input.supplier],
          amount: toDb(paymentAmounts[i]),
          method: p.method,
          reference: p.reference,
          paidById: ctx.user.owner,
          paidAt: at(p.daysAgo, 15),
          createdAt: at(p.daysAgo, 15),
        },
      });
      await writeAudit(tx, {
        userId: ctx.user.owner,
        branchId,
        action: "supplierPayment.create",
        entityType: "SupplierPayment",
        entityId: paymentId,
        after: { purchaseOrderNumber: number, amount: toDb(paymentAmounts[i]), method: p.method },
      });
    }

    await writeAudit(tx, {
      userId: receivedById,
      branchId,
      action: "purchaseOrder.receive",
      entityType: "PurchaseOrder",
      entityId: poId,
      after: {
        number,
        supplier: SUPPLIERS[input.supplier].name,
        paymentTerms: input.terms,
        totalCost: toDb(totalCost),
        serializedUnits: unitRows.length,
        accessoryLines: input.accessories.length,
      },
    });
  }, TX_OPTIONS);
}

type TransferLine = { unit: string } | { product: ProductKey; quantity: number; received?: number; note?: string };

async function createTransfer(
  ctx: Ctx,
  input: {
    key: string;
    from: BranchCode;
    to: BranchCode;
    createdDaysAgo: number;
    shipped: { daysAgo: number; by: string };
    received: { daysAgo: number; by: string } | null;
    approvedBy: string;
    driverName: string;
    lines: TransferLine[];
  },
): Promise<void> {
  const transferId = seedId(`transfer:${input.key}`);
  const fromId = ctx.branch[input.from].id;
  const toId = ctx.branch[input.to].id;

  await ctx.db.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, fromId, "TRANSFER");
    const createdById = input.shipped.by;
    let hasDiscrepancy = false;

    const items: Prisma.StockTransferItemCreateManyInput[] = [];
    for (const [i, line] of input.lines.entries()) {
      if ("unit" in line) {
        const unitId = seedId(`unit:${line.unit}`);
        const unit = await tx.serializedUnit.findUniqueOrThrow({ where: { id: unitId }, select: { productId: true } });
        // Ship: lock the unit in transit at the source (same conditional update the service will use).
        const shipped = await tx.serializedUnit.updateMany({
          where: { id: unitId, branchId: fromId, status: "IN_STOCK" },
          data: { status: "IN_TRANSIT" },
        });
        if (shipped.count !== 1) throw new Error(`Unit ${line.unit} is not in stock at ${input.from}`);
        if (input.received) {
          await tx.serializedUnit.update({ where: { id: unitId }, data: { status: "IN_STOCK", branchId: toId } });
        }
        items.push({
          id: seedId(`transfer-item:${input.key}:${i}`),
          transferId,
          productId: unit.productId,
          serializedUnitId: unitId,
          quantity: 1,
          receivedQuantity: input.received ? 1 : null,
        });
      } else {
        const productId = ctx.product[line.product];
        await tx.branchInventory.update({
          where: { productId_branchId: { productId, branchId: fromId } },
          data: { quantity: { decrement: line.quantity }, reservedQuantity: { increment: line.quantity } },
        });
        let receivedQuantity: number | null = null;
        if (input.received) {
          receivedQuantity = line.received ?? line.quantity;
          if (receivedQuantity < line.quantity) hasDiscrepancy = true;
          await tx.branchInventory.update({
            where: { productId_branchId: { productId, branchId: fromId } },
            data: { reservedQuantity: { decrement: line.quantity } },
          });
          await addStock(tx, toId, productId, receivedQuantity);
        }
        items.push({
          id: seedId(`transfer-item:${input.key}:${i}`),
          transferId,
          productId,
          quantity: line.quantity,
          receivedQuantity,
          discrepancyNote: line.note ?? null,
        });
      }
    }

    await tx.stockTransfer.create({
      data: {
        id: transferId,
        number,
        fromBranchId: fromId,
        toBranchId: toId,
        status: input.received ? "RECEIVED" : "IN_TRANSIT",
        createdById,
        approvedById: input.approvedBy,
        approvedAt: at(input.shipped.daysAgo, 9),
        shippedById: input.shipped.by,
        shippedAt: at(input.shipped.daysAgo, 10),
        receivedById: input.received?.by ?? null,
        receivedAt: input.received ? at(input.received.daysAgo, 14) : null,
        hasDiscrepancy,
        driverName: input.driverName,
        createdAt: at(input.createdDaysAgo, 16),
      },
    });
    await tx.stockTransferItem.createMany({ data: items });

    await writeAudit(tx, {
      userId: input.shipped.by,
      branchId: fromId,
      action: "transfer.ship",
      entityType: "StockTransfer",
      entityId: transferId,
      after: { number, from: input.from, to: input.to, items: items.length },
    });
    if (input.received) {
      await writeAudit(tx, {
        userId: input.received.by,
        branchId: toId,
        action: "transfer.receive",
        entityType: "StockTransfer",
        entityId: transferId,
        after: { number, hasDiscrepancy },
      });
    }
  }, TX_OPTIONS);
}

type SaleLine = { unit: string } | { product: ProductKey; quantity: number };

async function createSale(
  ctx: Ctx,
  input: {
    key: string;
    branch: BranchCode;
    customer: CustomerKey;
    cashier: string;
    daysAgo: number;
    lines: SaleLine[];
    discount?: string;
    tradeIn?: {
      product: ProductKey;
      description: string;
      condition: UnitCondition;
      batteryHealth: number;
      color: string;
      credit: string;
    };
    payments: { kind: "CHECKOUT" | "DOWN_PAYMENT"; amount: string; method: PaymentMethod; reference?: string }[];
    plan?: {
      downPayment: string;
      count: number;
      frequency: InstallmentFrequency;
      startDaysAgo: number;
      guarantorName: string;
      guarantorPhone: string;
      idVerificationNotes: string;
      approvedBy?: string;
    };
    repayments?: { daysAgo: number; amount: string; method: PaymentMethod; branch: BranchCode; by: string; reference?: string }[];
  },
): Promise<void> {
  const invoiceId = seedId(`invoice:${input.key}`);
  const branchId = ctx.branch[input.branch].id;
  const customerId = ctx.customer[input.customer];
  const soldAt = at(input.daysAgo, 13, 20);
  const saleDate = daysAgo(input.daysAgo);
  const taxRatePercent = "7.50";

  await ctx.db.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, branchId, "INVOICE");

    // Resolve lines with price/cost snapshots.
    type ResolvedLine = {
      productId: string;
      unitId: string | null;
      description: string;
      condition: UnitCondition | null;
      quantity: number;
      unitPrice: string;
      unitCost: string;
      warrantyMonths: number;
      productKey: ProductKey;
    };
    const lines: ResolvedLine[] = [];
    for (const line of input.lines) {
      if ("unit" in line) {
        const unit = await tx.serializedUnit.findUniqueOrThrow({
          where: { id: seedId(`unit:${line.unit}`) },
          include: { product: true },
        });
        const productKey = (Object.keys(PRODUCTS) as ProductKey[]).find((k) => ctx.product[k] === unit.productId);
        if (!productKey) throw new Error(`Unknown product for unit ${line.unit}`);
        const variant = [unit.color, unit.storage].filter(Boolean).join(", ");
        lines.push({
          productId: unit.productId,
          unitId: unit.id,
          description: variant ? `${unit.product.name} (${variant})` : unit.product.name,
          condition: unit.condition,
          quantity: 1,
          unitPrice: unit.sellingPrice.toFixed(2),
          unitCost: unit.costPrice.toFixed(2),
          warrantyMonths: unit.product.warrantyMonths,
          productKey,
        });
      } else {
        const p = PRODUCTS[line.product];
        lines.push({
          productId: ctx.product[line.product],
          unitId: null,
          description: p.name,
          condition: null,
          quantity: line.quantity,
          unitPrice: toDb(p.price),
          unitCost: toDb(p.cost),
          warrantyMonths: p.warrantyMonths,
          productKey: line.product,
        });
      }
    }

    const totals = computeInvoiceTotals({
      lines: lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
      discount: input.discount ?? "0",
      taxRatePercent,
      tradeInCredit: input.tradeIn?.credit ?? "0",
    });

    const repayments = input.repayments ?? [];
    const amountPaid = sum([...input.payments.map((p) => p.amount), ...repayments.map((r) => r.amount)]);
    const balance = totals.total.minus(amountPaid);
    if (balance.isNegative()) throw new Error(`${input.key}: payments exceed invoice total`);
    if (!input.plan && !balance.isZero()) throw new Error(`${input.key}: full-payment sale must be paid in full`);
    const status = balance.isZero() ? "PAID" : amountPaid.isZero() ? "UNPAID" : "PARTIALLY_PAID";

    await tx.invoice.create({
      data: {
        id: invoiceId,
        number,
        branchId,
        customerId,
        cashierId: input.cashier,
        subtotal: toDb(totals.subtotal),
        discount: toDb(totals.discount),
        taxRate: taxRatePercent,
        taxAmount: toDb(totals.taxAmount),
        tradeInCredit: toDb(totals.tradeInCredit),
        total: toDb(totals.total),
        amountPaid: toDb(amountPaid),
        balance: toDb(balance),
        paymentType: input.plan ? "INSTALLMENT" : "FULL",
        status,
        createdAt: soldAt,
      },
    });

    for (const [i, l] of lines.entries()) {
      const itemId = seedId(`invoice-item:${input.key}:${i}`);
      await tx.invoiceItem.create({
        data: {
          id: itemId,
          invoiceId,
          productId: l.productId,
          serializedUnitId: l.unitId,
          description: l.description,
          condition: l.condition,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitCost: l.unitCost,
          lineTotal: toDb(totals.lineTotals[i]),
          warrantyMonths: l.warrantyMonths,
        },
      });

      if (l.unitId) {
        // Same guard the checkout service uses: only an IN_STOCK unit at the selling branch can be sold.
        const sold = await tx.serializedUnit.updateMany({
          where: { id: l.unitId, branchId, status: "IN_STOCK" },
          data: { status: "SOLD", soldAt },
        });
        if (sold.count !== 1) throw new Error(`${input.key}: unit ${l.description} is not sellable at ${input.branch}`);

        if (l.warrantyMonths > 0) {
          await tx.warrantyCard.create({
            data: {
              id: seedId(`warranty:${input.key}:${i}`),
              publicId: randomPublicId(),
              invoiceItemId: itemId,
              serializedUnitId: l.unitId,
              customerId,
              branchId,
              startsAt: toDbDate(saleDate),
              expiresAt: toDbDate(warrantyExpiry(saleDate, l.warrantyMonths)),
              terms: WARRANTY_TERMS,
              createdAt: soldAt,
            },
          });
        }
      } else {
        await tx.branchInventory.update({
          where: { productId_branchId: { productId: l.productId, branchId } },
          data: { quantity: { decrement: l.quantity } },
        });
      }
    }

    if (input.tradeIn) {
      const t = input.tradeIn;
      const unitId = seedId(`unit:tradein:${input.key}`);
      const ids = unitIdentifiers({ key: `tradein:${input.key}`, product: t.product, condition: t.condition });
      await tx.serializedUnit.create({
        data: {
          id: unitId,
          productId: ctx.product[t.product],
          ...ids,
          branchId,
          condition: t.condition,
          color: t.color,
          batteryHealth: t.batteryHealth,
          costPrice: toDb(t.credit),
          sellingPrice: toDb(PRODUCTS[t.product].price),
          status: "TRADED_IN",
          receivedAt: soldAt,
          notes: "Trade-in awaiting inspection and intake",
          createdAt: soldAt,
        },
      });
      await tx.tradeIn.create({
        data: {
          id: seedId(`tradein:${input.key}`),
          invoiceId,
          customerId,
          branchId,
          productId: ctx.product[t.product],
          description: t.description,
          imei: ids.imei,
          serialNumber: ids.serialNumber,
          condition: t.condition,
          creditAmount: toDb(t.credit),
          serializedUnitId: unitId,
          assessedById: input.cashier,
          createdAt: soldAt,
        },
      });
    }

    for (const [i, p] of input.payments.entries()) {
      await tx.customerPayment.create({
        data: {
          id: seedId(`customer-payment:${input.key}:${i}`),
          invoiceId,
          customerId,
          branchId,
          amount: toDb(p.amount),
          method: p.method,
          reference: p.reference ?? null,
          kind: p.kind,
          receivedById: input.cashier,
          paidAt: soldAt,
          createdAt: soldAt,
        },
      });
    }

    if (input.plan) {
      const plan = input.plan;
      const planId = seedId(`plan:${input.key}`);
      const financedAmount = totals.total.minus(money(plan.downPayment));
      const rows = generateInstallmentSchedule({
        financedAmount,
        numberOfInstallments: plan.count,
        frequency: plan.frequency,
        startDate: daysAgo(plan.startDaysAgo),
      });

      // Allocate repayments to the oldest rows first (what payment.service will do).
      let pool = sum(repayments.map((r) => r.amount));
      const lastRepaymentAt = repayments.length ? at(repayments[repayments.length - 1].daysAgo, 12) : null;
      const scheduleRows = rows.map((row) => {
        const paid = pool.lessThan(row.amountDue) ? pool : row.amountDue;
        pool = pool.minus(paid);
        const fullyPaid = paid.equals(row.amountDue);
        const status = fullyPaid
          ? "PAID"
          : row.dueDate < TODAY
            ? "OVERDUE"
            : paid.isZero()
              ? "PENDING"
              : "PARTIAL";
        return { row, paid, status, fullyPaid } as const;
      });
      const nextUnpaid = scheduleRows.find((r) => !r.fullyPaid);

      await tx.installmentPlan.create({
        data: {
          id: planId,
          invoiceId,
          downPayment: toDb(plan.downPayment),
          financedAmount: toDb(financedAmount),
          numberOfInstallments: plan.count,
          frequency: plan.frequency,
          startDate: toDbDate(daysAgo(plan.startDaysAgo)),
          nextDueDate: nextUnpaid ? toDbDate(nextUnpaid.row.dueDate) : null,
          guarantorName: plan.guarantorName,
          guarantorPhone: normalizePhoneOrThrow(plan.guarantorPhone),
          idVerificationNotes: plan.idVerificationNotes,
          requiresApproval: Boolean(plan.approvedBy),
          approvedById: plan.approvedBy ?? null,
          approvedAt: plan.approvedBy ? soldAt : null,
          status: balance.isZero() ? "COMPLETED" : "ACTIVE",
          createdAt: soldAt,
        },
      });
      await tx.installmentSchedule.createMany({
        data: scheduleRows.map((r) => ({
          id: seedId(`schedule:${input.key}:${r.row.sequence}`),
          planId,
          sequence: r.row.sequence,
          dueDate: toDbDate(r.row.dueDate),
          amountDue: toDb(r.row.amountDue),
          amountPaid: toDb(r.paid),
          status: r.status,
          paidAt: r.fullyPaid ? lastRepaymentAt : null,
          createdAt: soldAt,
        })),
      });
    }

    for (const [i, r] of repayments.entries()) {
      const paymentId = seedId(`repayment:${input.key}:${i}`);
      const collectingBranchId = ctx.branch[r.branch].id;
      await tx.customerPayment.create({
        data: {
          id: paymentId,
          invoiceId,
          customerId,
          branchId: collectingBranchId,
          amount: toDb(r.amount),
          method: r.method,
          reference: r.reference ?? null,
          kind: "INSTALLMENT",
          receivedById: r.by,
          paidAt: at(r.daysAgo, 12),
          createdAt: at(r.daysAgo, 12),
        },
      });
      await writeAudit(tx, {
        userId: r.by,
        branchId: collectingBranchId,
        action: "payment.record",
        entityType: "CustomerPayment",
        entityId: paymentId,
        after: { invoiceNumber: number, amount: toDb(r.amount), method: r.method, kind: "INSTALLMENT" },
      });
    }

    await writeAudit(tx, {
      userId: input.cashier,
      branchId,
      action: "invoice.checkout",
      entityType: "Invoice",
      entityId: invoiceId,
      after: {
        number,
        customer: CUSTOMERS[input.customer].name,
        total: toDb(totals.total),
        paymentType: input.plan ? "INSTALLMENT" : "FULL",
        lines: lines.length,
      },
    });
  }, TX_OPTIONS);
}

/** Warranty runs to the day before the same calendar day N months later. */
function warrantyExpiry(start: CalendarDate, months: number): CalendarDate {
  return addDays(addMonths(start, months), -1);
}

// ─── Notifications ───────────────────────────────────────────────────────────

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "");
}

async function seedNotifications(ctx: Ctx): Promise<void> {
  const templates = Object.fromEntries(TEMPLATES.map((t) => [t.key, t]));
  const adaezeInvoice = await ctx.db.invoice.findUniqueOrThrow({
    where: { id: seedId("invoice:adaeze-full") },
    include: { items: { include: { warrantyCard: true } }, branch: true },
  });
  const tundePayment = await ctx.db.customerPayment.findUniqueOrThrow({
    where: { id: seedId("repayment:tunde-installment:0") },
    include: { invoice: true, branch: true },
  });
  const chiomaRow = await ctx.db.installmentSchedule.findUniqueOrThrow({
    where: { id: seedId("schedule:chioma-installment:2") },
    include: { plan: { include: { invoice: { include: { branch: true } } } } },
  });
  const adaezeCard = adaezeInvoice.items.find((i) => i.warrantyCard)?.warrantyCard;
  if (!adaezeCard) throw new Error("Adaeze's warranty card is missing");

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const phones = Object.fromEntries(
    (Object.keys(CUSTOMERS) as CustomerKey[]).map((k) => [k, normalizePhoneOrThrow(CUSTOMERS[k].phone)]),
  );
  const ngn = (v: { toFixed(dp: number): string }) => `NGN ${v.toFixed(2)}`;

  const rows: Prisma.NotificationLogCreateManyInput[] = [
    {
      id: seedId("notification:adaeze-receipt"),
      customerId: ctx.customer.adaeze,
      invoiceId: adaezeInvoice.id,
      templateKey: "receipt",
      channel: "WHATSAPP",
      provider: "console",
      to: phones.adaeze,
      body: render(templates.receipt.body, {
        customer_name: "Adaeze",
        branch_name: adaezeInvoice.branch.name,
        invoice_number: adaezeInvoice.number,
        invoice_total: ngn(adaezeInvoice.total),
      }),
      mediaUrl: `${appUrl}/api/pdf/invoice/${adaezeInvoice.id}`,
      status: "DELIVERED",
      providerMessageId: "console-seed-0001",
      attempts: 1,
      dedupeKey: `receipt:${adaezeInvoice.id}`,
      triggeredById: null,
      lastAttemptAt: at(10, 13, 21),
      sentAt: at(10, 13, 21),
      deliveredAt: at(10, 13, 22),
      createdAt: at(10, 13, 21),
    },
    {
      id: seedId("notification:adaeze-warranty"),
      customerId: ctx.customer.adaeze,
      invoiceId: adaezeInvoice.id,
      templateKey: "warranty_card",
      channel: "WHATSAPP",
      provider: "console",
      to: phones.adaeze,
      body: render(templates.warranty_card.body, {
        customer_name: "Adaeze",
        device_name: PRODUCTS.iphone15pro.name,
        serial_masked: "IMEI ••••",
        warranty_expiry: adaezeCard.expiresAt.toISOString().slice(0, 10),
        warranty_link: `${appUrl}/w/${adaezeCard.publicId}`,
      }),
      mediaUrl: `${appUrl}/api/pdf/warranty/${adaezeCard.id}`,
      status: "DELIVERED",
      providerMessageId: "console-seed-0002",
      attempts: 1,
      dedupeKey: `warranty_card:${adaezeCard.id}`,
      lastAttemptAt: at(10, 13, 21),
      sentAt: at(10, 13, 21),
      deliveredAt: at(10, 13, 23),
      createdAt: at(10, 13, 21),
    },
    {
      id: seedId("notification:tunde-payment"),
      customerId: ctx.customer.tunde,
      invoiceId: tundePayment.invoiceId,
      templateKey: "payment_confirmation",
      channel: "WHATSAPP",
      provider: "console",
      to: phones.tunde,
      body: render(templates.payment_confirmation.body, {
        customer_name: "Tunde",
        amount_paid: ngn(tundePayment.amount),
        invoice_number: tundePayment.invoice.number,
        branch_name: tundePayment.branch.name,
        balance_remaining: ngn(tundePayment.invoice.balance),
      }),
      status: "DELIVERED",
      providerMessageId: "console-seed-0003",
      attempts: 1,
      dedupeKey: `payment_confirmation:${tundePayment.id}`,
      triggeredById: ctx.user["cashier.MAIN"],
      lastAttemptAt: at(6, 12, 1),
      sentAt: at(6, 12, 1),
      deliveredAt: at(6, 12, 2),
      createdAt: at(6, 12, 1),
    },
  ];

  const overdueVars = {
    customer_name: "Chioma",
    amount_due: ngn(chiomaRow.amountDue),
    invoice_number: chiomaRow.plan.invoice.number,
    due_date: chiomaRow.dueDate.toISOString().slice(0, 10),
    balance_remaining: ngn(chiomaRow.plan.invoice.balance),
    branch_name: chiomaRow.plan.invoice.branch.name,
    payment_instructions: PAYMENT_INSTRUCTIONS,
  };
  const whatsappRowId = seedId("notification:chioma-overdue-7d");
  const dedupeBase = `installment_overdue_7d:${chiomaRow.id}:7`;
  rows.push(
    {
      id: whatsappRowId,
      customerId: ctx.customer.chioma,
      invoiceId: chiomaRow.plan.invoiceId,
      templateKey: "installment_overdue_7d",
      channel: "WHATSAPP",
      provider: "console",
      to: phones.chioma,
      body: render(templates.installment_overdue_7d.body, overdueVars),
      status: "FAILED",
      error: "Recipient is not a WhatsApp user (simulated)",
      attempts: 1,
      dedupeKey: dedupeBase,
      lastAttemptAt: at(5, 9, 0),
      failedAt: at(5, 9, 0),
      createdAt: at(5, 9, 0),
    },
    {
      id: seedId("notification:chioma-overdue-7d-sms"),
      customerId: ctx.customer.chioma,
      invoiceId: chiomaRow.plan.invoiceId,
      templateKey: "installment_overdue_7d",
      channel: "SMS",
      provider: "console",
      to: phones.chioma,
      body: render(templates.installment_overdue_7d.smsBody, overdueVars),
      status: "SENT",
      providerMessageId: "console-seed-0004",
      attempts: 1,
      dedupeKey: `${dedupeBase}:SMS`,
      parentId: whatsappRowId,
      lastAttemptAt: at(5, 9, 0),
      sentAt: at(5, 9, 0),
      createdAt: at(5, 9, 0),
    },
  );

  await ctx.db.notificationLog.createMany({ data: rows, skipDuplicates: true });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = createPrismaClient();
  const log: string[] = [];
  try {
    const password = process.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD;
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const ctx = await seedReferenceData(db, passwordHash);
    log.push("  ✓ branches, users, products, suppliers, customers, templates, settings");

    const owner = ctx.user.owner;

    // Units received ~90 days ago at the warehouse: the source of the 60+ day aging alerts.
    await once(
      "PO paid in full — Apex → Central Warehouse (90 days ago)",
      () => db.purchaseOrder.findUnique({ where: { id: seedId("po:apex-wh") } }),
      () =>
        createPurchaseOrder(ctx, {
          key: "apex-wh",
          supplier: "apex",
          branch: "WH",
          terms: "PAID_IN_FULL",
          receivedDaysAgo: 90,
          dueDaysAfterReceipt: null,
          supplierReference: "APX-INV-20931",
          units: [
            { key: "wh-ip15p-1", product: "iphone15pro", condition: "BRAND_NEW", color: "Natural Titanium", storage: "256GB", ram: "8GB" },
            { key: "wh-ip15p-2", product: "iphone15pro", condition: "BRAND_NEW", color: "Black Titanium", storage: "256GB", ram: "8GB" },
            { key: "wh-ip15p-3", product: "iphone15pro", condition: "BRAND_NEW", color: "Blue Titanium", storage: "256GB", ram: "8GB" },
            { key: "wh-ps5-1", product: "ps5", condition: "BRAND_NEW", storage: "1TB", serialNumber: "E7A2100481234" },
            { key: "wh-ps5-2", product: "ps5", condition: "BRAND_NEW", storage: "1TB", serialNumber: "E7A2100481235" },
            { key: "wh-aw9-1", product: "watch9", condition: "BRAND_NEW", color: "Midnight", serialNumber: "G99XK1PLQ1N4" },
            { key: "wh-aw9-2", product: "watch9", condition: "BRAND_NEW", color: "Starlight", serialNumber: "G99XK1PLQ1N7" },
            { key: "wh-mba-1", product: "macbookAir", condition: "BRAND_NEW", color: "Midnight", storage: "512GB", ram: "16GB", serialNumber: "FVFHM3MBA0A1" },
            { key: "wh-mba-2", product: "macbookAir", condition: "BRAND_NEW", color: "Starlight", storage: "512GB", ram: "16GB", serialNumber: "FVFHM3MBA0A2" },
          ],
          accessories: [
            { product: "charger", quantity: 60 },
            { product: "cable", quantity: 80 },
            { product: "protector", quantity: 100 },
            { product: "earbuds", quantity: 40 },
          ],
          payments: [{ daysAgo: 90, amount: "FULL", method: "BANK_TRANSFER", reference: "ZEN-TRF-558120" }],
        }),
      log,
    );

    // Net 15, never paid: due 40 days ago → overdue payable.
    await once(
      "PO overdue (Net 15, unpaid) — Lagos Tech → Ikeja (55 days ago)",
      () => db.purchaseOrder.findUnique({ where: { id: seedId("po:lagostech-ikj") } }),
      () =>
        createPurchaseOrder(ctx, {
          key: "lagostech-ikj",
          supplier: "lagosTech",
          branch: "IKJ",
          terms: "NET_15",
          receivedDaysAgo: 55,
          dueDaysAfterReceipt: 15,
          supplierReference: "LTW-7781",
          units: [
            { key: "ikj-ip15p-1", product: "iphone15pro", condition: "BRAND_NEW", color: "Natural Titanium", storage: "256GB", ram: "8GB" },
            { key: "ikj-ip15p-2", product: "iphone15pro", condition: "BRAND_NEW", color: "White Titanium", storage: "256GB", ram: "8GB" },
            { key: "ikj-s24u-1", product: "s24ultra", condition: "BRAND_NEW", color: "Titanium Gray", storage: "256GB", ram: "12GB" },
            { key: "ikj-s24u-2", product: "s24ultra", condition: "BRAND_NEW", color: "Titanium Black", storage: "256GB", ram: "12GB" },
            { key: "ikj-aw9-1", product: "watch9", condition: "OPEN_BOX", color: "Silver", cost: "410000", price: "500000", serialNumber: "G99XK2OBX0B3" },
            { key: "ikj-ip13-1", product: "iphone13", condition: "UK_USED", color: "Midnight", storage: "128GB", ram: "4GB", batteryHealth: 88 },
            { key: "ikj-ip13-2", product: "iphone13", condition: "UK_USED", color: "Pink", storage: "128GB", ram: "4GB", batteryHealth: 91 },
          ],
          accessories: [
            { product: "charger", quantity: 10 },
            { product: "protector", quantity: 8 },
            { product: "cable", quantity: 15 },
          ],
          payments: [],
        }),
      log,
    );

    // Completed transfer with an accessory discrepancy (5 earbuds shipped, 3 received).
    await once(
      "Transfer received — Central Warehouse → Lekki (with discrepancy)",
      () => db.stockTransfer.findUnique({ where: { id: seedId("transfer:wh-lek") } }),
      () =>
        createTransfer(ctx, {
          key: "wh-lek",
          from: "WH",
          to: "LEK",
          createdDaysAgo: 76,
          shipped: { daysAgo: 75, by: owner },
          received: { daysAgo: 74, by: ctx.user["manager.LEK"] },
          approvedBy: owner,
          driverName: "Musa Garba",
          lines: [
            { unit: "wh-ip15p-1" },
            { unit: "wh-mba-1" },
            { unit: "wh-ps5-1" },
            { product: "charger", quantity: 20 },
            { product: "cable", quantity: 20 },
            { product: "protector", quantity: 30 },
            { product: "earbuds", quantity: 5, received: 3, note: "2 units missing — carton damaged in transit" },
          ],
        }),
      log,
    );

    // Instalment sale with one repayment made and one OVERDUE row (due 12 days ago).
    await once(
      "Installment sale with an overdue instalment — Chioma Eze @ Ikeja",
      () => db.invoice.findUnique({ where: { id: seedId("invoice:chioma-installment") } }),
      () =>
        createSale(ctx, {
          key: "chioma-installment",
          branch: "IKJ",
          customer: "chioma",
          cashier: ctx.user["cashier.IKJ"],
          daysAgo: 40,
          lines: [{ unit: "ikj-s24u-1" }],
          payments: [{ kind: "DOWN_PAYMENT", amount: "403125.00", method: "CASH" }],
          plan: {
            downPayment: "403125.00",
            count: 6,
            frequency: "BI_WEEKLY",
            startDaysAgo: 26,
            guarantorName: "Obinna Eze",
            guarantorPhone: "0809 111 2233",
            idVerificationNotes: "NIN slip and utility bill sighted",
          },
          repayments: [
            { daysAgo: 26, amount: "156770.83", method: "BANK_TRANSFER", branch: "IKJ", by: ctx.user["cashier.IKJ"], reference: "GTB-88213" },
          ],
        }),
      log,
    );

    // Instalment sale above the approval threshold, down payment + one repayment collected at another branch.
    await once(
      "Active installment plan (manager-approved) — Tunde Bakare @ Lekki",
      () => db.invoice.findUnique({ where: { id: seedId("invoice:tunde-installment") } }),
      () =>
        createSale(ctx, {
          key: "tunde-installment",
          branch: "LEK",
          customer: "tunde",
          cashier: ctx.user["cashier.LEK"],
          daysAgo: 35,
          lines: [{ unit: "wh-mba-1" }],
          discount: "50000",
          payments: [{ kind: "DOWN_PAYMENT", amount: "731000.00", method: "POS_CARD", reference: "POS-LEK-301122" }],
          plan: {
            downPayment: "731000.00",
            count: 4,
            frequency: "MONTHLY",
            startDaysAgo: 5,
            guarantorName: "Kunle Bakare",
            guarantorPhone: "0803 999 0011",
            idVerificationNotes: "Driver's licence sighted; employer letter on file",
            approvedBy: ctx.user["manager.LEK"],
          },
          repayments: [
            { daysAgo: 6, amount: "274125.00", method: "CASH", branch: "MAIN", by: ctx.user["cashier.MAIN"] },
          ],
        }),
      log,
    );

    // Net 30 with a partial payout; due in 10 days.
    await once(
      "PO on Net 30 with partial payout — Lagos Tech → Main (20 days ago)",
      () => db.purchaseOrder.findUnique({ where: { id: seedId("po:lagostech-main") } }),
      () =>
        createPurchaseOrder(ctx, {
          key: "lagostech-main",
          supplier: "lagosTech",
          branch: "MAIN",
          terms: "NET_30",
          receivedDaysAgo: 20,
          dueDaysAfterReceipt: 30,
          supplierReference: "LTW-8020",
          units: [
            { key: "main-s24u-1", product: "s24ultra", condition: "BRAND_NEW", color: "Titanium Violet", storage: "256GB", ram: "12GB" },
            { key: "main-s24u-2", product: "s24ultra", condition: "BRAND_NEW", color: "Titanium Gray", storage: "256GB", ram: "12GB" },
            { key: "main-ip13-1", product: "iphone13", condition: "UK_USED", color: "Blue", storage: "128GB", ram: "4GB", batteryHealth: 85 },
            { key: "main-ip13-2", product: "iphone13", condition: "UK_USED", color: "Starlight", storage: "128GB", ram: "4GB", batteryHealth: 87 },
            { key: "main-eb840-1", product: "elitebook", condition: "REFURBISHED", color: "Silver", storage: "512GB", ram: "16GB", serialNumber: "5CG1234XYZ" },
            { key: "main-eb840-2", product: "elitebook", condition: "US_USED", color: "Silver", storage: "512GB", ram: "16GB", serialNumber: "5CG1234XZA" },
            { key: "main-ps5-1", product: "ps5", condition: "OPEN_BOX", storage: "1TB", cost: "640000", price: "760000", serialNumber: "E7A2100489901" },
            { key: "main-mba-1", product: "macbookAir", condition: "OPEN_BOX", color: "Space Gray", storage: "512GB", ram: "16GB", cost: "1350000", price: "1600000", serialNumber: "FVFHM3MBA0B9" },
          ],
          accessories: [
            { product: "charger", quantity: 15 },
            { product: "cable", quantity: 12 },
            { product: "protector", quantity: 25 },
            { product: "earbuds", quantity: 10 },
          ],
          payments: [{ daysAgo: 5, amount: "2000000.00", method: "BANK_TRANSFER", reference: "ZEN-TRF-601877" }],
        }),
      log,
    );

    // Paid-in-full sale with split payment and a trade-in.
    await once(
      "Paid-in-full sale with trade-in and split payment — Adaeze Okafor @ Ikeja",
      () => db.invoice.findUnique({ where: { id: seedId("invoice:adaeze-full") } }),
      () =>
        createSale(ctx, {
          key: "adaeze-full",
          branch: "IKJ",
          customer: "adaeze",
          cashier: ctx.user["cashier.IKJ"],
          daysAgo: 10,
          lines: [{ unit: "ikj-ip15p-1" }, { product: "protector", quantity: 1 }, { product: "charger", quantity: 1 }],
          tradeIn: {
            product: "iphone11",
            description: "Apple iPhone 11 64GB, Black, minor scratches",
            condition: "UK_USED",
            batteryHealth: 79,
            color: "Black",
            credit: "150000",
          },
          payments: [
            { kind: "CHECKOUT", amount: "1000000.00", method: "POS_CARD", reference: "POS-IKJ-772310" },
            { kind: "CHECKOUT", amount: "321137.50", method: "BANK_TRANSFER", reference: "ACC-TRF-009812" },
          ],
        }),
      log,
    );

    // In transit right now: one phone and 10 cables locked from sale.
    await once(
      "Transfer in transit — Main → Lekki",
      () => db.stockTransfer.findUnique({ where: { id: seedId("transfer:main-lek") } }),
      () =>
        createTransfer(ctx, {
          key: "main-lek",
          from: "MAIN",
          to: "LEK",
          createdDaysAgo: 1,
          shipped: { daysAgo: 1, by: ctx.user["manager.MAIN"] },
          received: null,
          approvedBy: ctx.user["manager.MAIN"],
          driverName: "Sunday Okon",
          lines: [{ unit: "main-s24u-1" }, { product: "cable", quantity: 10 }],
        }),
      log,
    );

    await seedNotifications(ctx);
    log.push("  ✓ notification log samples (incl. a WhatsApp → SMS fallback)");

    console.log("\nSeed complete:\n" + log.join("\n"));
    console.log(`\nDev logins (password: ${process.env.SEED_PASSWORD ? "$SEED_PASSWORD" : DEFAULT_SEED_PASSWORD})`);
    console.table(
      USERS.map((u) => ({ email: u.email, name: u.name, role: u.role, branch: u.branch ?? "ALL" })),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
