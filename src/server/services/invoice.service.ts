import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { addDays, addMonths, type CalendarDate, generateInstallmentSchedule, parseCalendarDate, toDbDate, todayInStoreTz } from "@/lib/dates";
import { checkIdentifier } from "@/lib/identifiers";
import { randomPublicId } from "@/lib/ids";
import { installmentApproval } from "@/lib/installments";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import { nextDocumentNumber } from "@/lib/invoice-number";
import { money, sum, toDb, ZERO } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import type { CheckoutInput } from "@/lib/validators/checkout";
import { assertCan, can, type Ctx } from "@/server/auth/permissions";
import { resolveWriteBranchId } from "@/server/branch-context";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit.service";
import { checkCredentials } from "@/server/services/auth.service";
import { lockedMinutes, recordFailure, recordSuccess, throttleKeys } from "@/server/services/throttle.service";
import { getSetting } from "@/server/services/settings.service";

const TX_OPTIONS = { timeout: 20_000, maxWait: 5_000 };
const MAX_FIRST_DUE_DAYS = 90;
const DEFAULT_TERMS = "Covers manufacturing defects for the period shown. Excludes physical and liquid damage.";

const moneySetting = z.union([z.string(), z.number()]).transform(String);

export type CheckoutSettings = { vatRatePercent: string; approvalThreshold: string; minDownPaymentPercent: string };

/** VAT and installment approval rules, from Settings (defaults match the seed). */
export async function getCheckoutSettings(): Promise<CheckoutSettings> {
  const [vatRatePercent, approvalThreshold, minDownPaymentPercent] = await Promise.all([
    getSetting("tax.vatRatePercent", moneySetting, "7.50"),
    getSetting("installments.approvalThreshold", moneySetting, "1000000.00"),
    getSetting("installments.minDownPaymentPercent", moneySetting, "30"),
  ]);
  return { vatRatePercent, approvalThreshold, minDownPaymentPercent };
}

export type CheckoutResult = {
  invoiceId: string;
  number: string;
  customerName: string;
  paymentType: "FULL" | "INSTALLMENT";
  total: string;
  amountPaid: string;
  balance: string;
  nextDueDate: CalendarDate | null;
  warrantyCardIds: string[];
};

/** Warranty runs to the day before the same calendar day N months later. */
function warrantyExpiry(start: CalendarDate, months: number): CalendarDate {
  return addDays(addMonths(start, months), -1);
}

/** Who approves an installment plan that needs it: the seller if allowed, else the manager who signed in. */
async function resolveApprover(ctx: Ctx, branchId: string, approver: { email: string; password: string } | undefined): Promise<string> {
  if (can(ctx, "installment.approve", { branchId })) return ctx.userId;
  if (!approver) throw new ForbiddenError("This plan needs a manager's approval. Ask a manager to approve it.");
  const keys = throttleKeys("approve", approver.email, { userId: ctx.userId });
  const locked = await lockedMinutes(keys);
  if (locked !== null) throw new ForbiddenError(`Too many wrong approvals. Try again in ${locked} minute${locked === 1 ? "" : "s"}.`);
  const user = await checkCredentials(approver);
  if (!user) {
    await recordFailure(keys);
    throw new ForbiddenError("That manager email or password is incorrect.");
  }
  await recordSuccess(keys);
  const approverCtx: Ctx = { userId: user.id, role: user.role, branchId: user.branchId, activeBranchId: user.branchId };
  if (!can(approverCtx, "installment.approve", { branchId })) {
    throw new ForbiddenError(`${user.name} can't approve installment plans at this branch.`);
  }
  return user.id;
}

/**
 * Checkout (CLAUDE.md §7.4). Prices and costs are read from the database, never the client.
 * One transaction: invoice + items, units SOLD (conditional per IMEI — invariant 3), accessory
 * quantities, payments, installment plan + schedule, warranty cards, trade-in, audit row.
 */
export async function checkout(ctx: Ctx, input: CheckoutInput, options: { now?: Date } = {}): Promise<CheckoutResult> {
  assertCan(ctx, "invoice.create");
  const branchId = resolveWriteBranchId(ctx, input.branchId);
  const now = options.now ?? new Date();
  const today = todayInStoreTz(now);

  // ─── Load what's being sold ────────────────────────────────────────────────
  const unitIds = input.lines.flatMap((l) => (l.kind === "unit" ? [l.unitId] : []));
  const accessoryLines = input.lines.flatMap((l) => (l.kind === "accessory" ? [l] : []));
  if (new Set(unitIds).size !== unitIds.length) throw new ValidationError("A device is in the cart twice.");
  if (new Set(accessoryLines.map((l) => l.productId)).size !== accessoryLines.length) {
    throw new ValidationError("An accessory is in the cart twice — change its quantity instead.");
  }

  const [customer, branch, units, accessories, settings, termsSetting] = await Promise.all([
    db.customer.findUnique({ where: { id: input.customerId }, select: { id: true, name: true } }),
    db.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } }),
    db.serializedUnit.findMany({
      where: { id: { in: unitIds } },
      include: { product: { select: { name: true, warrantyMonths: true } } },
    }),
    db.product.findMany({
      where: { id: { in: accessoryLines.map((l) => l.productId) } },
      include: { inventory: { where: { branchId }, select: { quantity: true } } },
    }),
    getCheckoutSettings(),
    getSetting("warranty.defaultTerms", z.string(), DEFAULT_TERMS),
  ]);
  if (!customer) throw new ValidationError("Select a customer.", { customerId: ["Select a customer"] });
  if (!branch) throw new ValidationError("This branch is not available.");

  const unitById = new Map(units.map((u) => [u.id, u]));
  const productById = new Map(accessories.map((p) => [p.id, p]));
  for (const id of unitIds) {
    const unit = unitById.get(id);
    if (!unit || unit.branchId !== branchId || unit.status !== "IN_STOCK") {
      const label = unit ? (unit.imei ?? unit.serialNumber) : "A device";
      throw new ValidationError(`${label} isn't in stock at this branch. Remove it to continue.`);
    }
  }
  for (const line of accessoryLines) {
    const product = productById.get(line.productId);
    if (!product || !product.isActive || product.trackingType !== "NON_SERIALIZED") throw new ValidationError("An accessory in the cart is no longer sold.");
    const available = product.inventory[0]?.quantity ?? 0;
    if (line.quantity > available) throw new ValidationError(`Only ${available} × ${product.name} left at this branch.`);
  }

  // ─── Totals (same arithmetic as the POS preview and the DB CHECKs) ────────
  const resolved = input.lines.map((line) => {
    if (line.kind === "unit") {
      const unit = unitById.get(line.unitId);
      if (!unit) throw new ValidationError("A device in the cart no longer exists.");
      const spec = [unit.storage, unit.color].filter(Boolean).join(", ");
      return {
        productId: unit.productId,
        unitId: unit.id,
        description: spec ? `${unit.product.name} (${spec})` : unit.product.name,
        condition: unit.condition,
        quantity: 1,
        unitPrice: unit.sellingPrice.toFixed(2),
        unitCost: unit.costPrice.toFixed(2),
        discount: line.discount ?? "0",
        warrantyMonths: unit.product.warrantyMonths,
      };
    }
    const product = productById.get(line.productId);
    if (!product) throw new ValidationError("An accessory in the cart no longer exists.");
    return {
      productId: product.id,
      unitId: null,
      description: product.name,
      condition: null,
      quantity: line.quantity,
      unitPrice: product.defaultSellingPrice.toFixed(2),
      unitCost: product.defaultCostPrice.toFixed(2),
      discount: line.discount ?? "0",
      warrantyMonths: product.warrantyMonths,
    };
  });

  let totals: ReturnType<typeof computeInvoiceTotals>;
  try {
    totals = computeInvoiceTotals({
      lines: resolved.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })),
      discount: input.discount ?? "0",
      taxRatePercent: settings.vatRatePercent,
      tradeInCredit: input.tradeIn?.creditAmount ?? "0",
    });
  } catch (error) {
    if (error instanceof RangeError) throw new ValidationError(error.message);
    throw error;
  }

  // ─── Trade-in ──────────────────────────────────────────────────────────────
  let tradeInIdentifier: { kind: "IMEI" | "SERIAL"; value: string } | null = null;
  if (input.tradeIn?.identifier) {
    const check = checkIdentifier(input.tradeIn.identifier);
    if (!check.ok) throw new ValidationError(`Trade-in ${check.value}: ${check.reason}`);
    tradeInIdentifier = { kind: check.kind, value: check.value };
  }
  if (input.tradeIn?.addToStock) {
    const product = await db.product.findUnique({ where: { id: input.tradeIn.productId ?? "" }, select: { trackingType: true } });
    if (product?.trackingType !== "SERIALIZED") throw new ValidationError("Choose the trade-in's device model.");
    if (tradeInIdentifier) {
      const taken = await db.serializedUnit.findFirst({
        where: { OR: [{ imei: tradeInIdentifier.value }, { serialNumber: tradeInIdentifier.value }] },
        select: { id: true },
      });
      if (taken) throw new ValidationError(`${tradeInIdentifier.value} is already recorded in stock.`);
    }
  }

  // ─── Payments and plan ─────────────────────────────────────────────────────
  const payment = input.payment;
  const paymentRows = payment.type === "FULL" ? payment.payments : payment.downPayments;
  for (const row of paymentRows) {
    if (money(row.amount).lte(0)) throw new ValidationError("Payment amounts must be more than zero.");
  }
  const amountPaid = sum(paymentRows.map((p) => p.amount));
  const balance = totals.total.minus(amountPaid);

  let planData: {
    schedule: ReturnType<typeof generateInstallmentSchedule>;
    financed: ReturnType<typeof money>;
    requiresApproval: boolean;
    approvedById: string | null;
    firstDueDate: CalendarDate;
  } | null = null;

  if (payment.type === "FULL") {
    if (!balance.isZero()) {
      throw new ValidationError(
        balance.gt(0)
          ? `Payments are ${balance.toFixed(2)} short of the total.`
          : `Payments are ${balance.negated().toFixed(2)} more than the total.`,
      );
    }
  } else {
    // decimal.js treats 0 as positive, so compare explicitly.
    if (balance.lte(0)) throw new ValidationError("The down payment covers the whole invoice — use full payment instead.");
    const firstDueDate = parseCalendarDate(payment.firstDueDate);
    if (firstDueDate <= today) throw new ValidationError("The first instalment must fall after today.", { "payment.firstDueDate": ["Must be after today"] });
    if (firstDueDate > addDays(today, MAX_FIRST_DUE_DAYS)) {
      throw new ValidationError(`The first instalment must fall within ${MAX_FIRST_DUE_DAYS} days.`);
    }
    if (payment.guarantorPhone && !normalizePhone(payment.guarantorPhone)) {
      throw new ValidationError("Enter a valid guarantor phone number.", { "payment.guarantorPhone": ["Invalid phone number"] });
    }
    const approval = installmentApproval({
      total: totals.total,
      downPayment: amountPaid,
      threshold: settings.approvalThreshold,
      minDownPaymentPercent: settings.minDownPaymentPercent,
    });
    let schedule: ReturnType<typeof generateInstallmentSchedule>;
    try {
      schedule = generateInstallmentSchedule({
        financedAmount: balance,
        numberOfInstallments: payment.numberOfInstallments,
        frequency: payment.frequency,
        startDate: firstDueDate,
      });
    } catch (error) {
      if (error instanceof RangeError) throw new ValidationError("The balance is too small to split into that many instalments.");
      throw error;
    }
    planData = {
      financed: balance,
      firstDueDate,
      requiresApproval: approval.required,
      approvedById: approval.required ? await resolveApprover(ctx, branchId, payment.approver) : null,
      schedule,
    };
  }

  const status: InvoiceStatus = balance.isZero() ? "PAID" : amountPaid.isZero() ? "UNPAID" : "PARTIALLY_PAID";

  // ─── Write ─────────────────────────────────────────────────────────────────
  try {
    return await db.$transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, branchId, "INVOICE");
      const invoice = await tx.invoice.create({
        data: {
          number,
          branchId,
          customerId: customer.id,
          cashierId: ctx.userId,
          subtotal: toDb(totals.subtotal),
          discount: toDb(totals.discount),
          taxRate: totals.taxRatePercent.toFixed(2),
          taxAmount: toDb(totals.taxAmount),
          tradeInCredit: toDb(totals.tradeInCredit),
          total: toDb(totals.total),
          amountPaid: toDb(amountPaid),
          balance: toDb(balance),
          paymentType: payment.type,
          status,
          createdAt: now,
        },
        select: { id: true },
      });

      const warrantyCardIds: string[] = [];
      for (const [index, line] of resolved.entries()) {
        const item = await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            productId: line.productId,
            serializedUnitId: line.unitId,
            description: line.description,
            condition: line.condition,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: toDb(line.discount),
            unitCost: line.unitCost,
            lineTotal: toDb(totals.lineTotals[index]),
            warrantyMonths: line.warrantyMonths,
          },
          select: { id: true },
        });

        if (line.unitId) {
          // Invariant 3: only an IN_STOCK unit at this branch can be sold; a concurrent sale makes this 0.
          const sold = await tx.serializedUnit.updateMany({
            where: { id: line.unitId, branchId, status: "IN_STOCK" },
            data: { status: "SOLD", soldAt: now },
          });
          if (sold.count !== 1) {
            const unit = unitById.get(line.unitId);
            throw new ConflictError(`${unit?.imei ?? unit?.serialNumber ?? "A device"} was sold a moment ago at this branch. Remove it to continue.`);
          }
          if (line.warrantyMonths > 0) {
            const card = await tx.warrantyCard.create({
              data: {
                publicId: randomPublicId(),
                invoiceItemId: item.id,
                serializedUnitId: line.unitId,
                customerId: customer.id,
                branchId,
                startsAt: toDbDate(today),
                expiresAt: toDbDate(warrantyExpiry(today, line.warrantyMonths)),
                terms: termsSetting,
              },
              select: { id: true },
            });
            warrantyCardIds.push(card.id);
          }
        } else {
          const taken = await tx.branchInventory.updateMany({
            where: { productId: line.productId, branchId, quantity: { gte: line.quantity } },
            data: { quantity: { decrement: line.quantity } },
          });
          if (taken.count !== 1) throw new ConflictError(`${line.description} just ran out at this branch. Adjust the quantity to continue.`);
        }
      }

      if (input.tradeIn) {
        const t = input.tradeIn;
        let tradeInUnitId: string | null = null;
        if (t.addToStock && t.productId && tradeInIdentifier) {
          const unit = await tx.serializedUnit.create({
            data: {
              productId: t.productId,
              imei: tradeInIdentifier.kind === "IMEI" ? tradeInIdentifier.value : null,
              serialNumber: tradeInIdentifier.kind === "SERIAL" ? tradeInIdentifier.value : null,
              branchId,
              condition: t.condition,
              costPrice: toDb(t.creditAmount),
              sellingPrice: toDb(t.creditAmount),
              status: "TRADED_IN",
              receivedAt: now,
              notes: `Traded in on ${number}; inspect and set a selling price before resale.`,
            },
            select: { id: true },
          });
          tradeInUnitId = unit.id;
        }
        await tx.tradeIn.create({
          data: {
            invoiceId: invoice.id,
            customerId: customer.id,
            branchId,
            productId: t.productId ?? null,
            description: t.description,
            imei: tradeInIdentifier?.kind === "IMEI" ? tradeInIdentifier.value : null,
            serialNumber: tradeInIdentifier?.kind === "SERIAL" ? tradeInIdentifier.value : null,
            condition: t.condition,
            creditAmount: toDb(t.creditAmount),
            serializedUnitId: tradeInUnitId,
            assessedById: ctx.userId,
          },
        });
      }

      if (paymentRows.length) {
        await tx.customerPayment.createMany({
          data: paymentRows.map((p) => ({
            invoiceId: invoice.id,
            customerId: customer.id,
            branchId,
            amount: toDb(p.amount),
            method: p.method,
            reference: p.reference ?? null,
            kind: payment.type === "FULL" ? ("CHECKOUT" as const) : ("DOWN_PAYMENT" as const),
            receivedById: ctx.userId,
            paidAt: now,
          })),
        });
      }

      if (planData && payment.type === "INSTALLMENT") {
        const plan = await tx.installmentPlan.create({
          data: {
            invoiceId: invoice.id,
            downPayment: toDb(amountPaid),
            financedAmount: toDb(planData.financed),
            numberOfInstallments: payment.numberOfInstallments,
            frequency: payment.frequency,
            startDate: toDbDate(planData.firstDueDate),
            nextDueDate: toDbDate(planData.firstDueDate),
            guarantorName: payment.guarantorName ?? null,
            guarantorPhone: payment.guarantorPhone ? normalizePhone(payment.guarantorPhone) : null,
            idVerificationNotes: payment.idVerificationNotes ?? null,
            requiresApproval: planData.requiresApproval,
            approvedById: planData.approvedById,
            approvedAt: planData.approvedById ? now : null,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        await tx.installmentSchedule.createMany({
          data: planData.schedule.map((row) => ({
            planId: plan.id,
            sequence: row.sequence,
            dueDate: toDbDate(row.dueDate),
            amountDue: toDb(row.amountDue),
          })),
        });
      }

      await writeAudit(tx, {
        userId: ctx.userId,
        branchId,
        action: "invoice.checkout",
        entityType: "Invoice",
        entityId: invoice.id,
        after: {
          number,
          customerId: customer.id,
          paymentType: payment.type,
          total: toDb(totals.total),
          amountPaid: toDb(amountPaid),
          units: resolved.flatMap((l) => (l.unitId ? [l.unitId] : [])),
          accessories: accessoryLines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          tradeInCredit: toDb(totals.tradeInCredit),
          installment: planData
            ? { count: planData.schedule.length, firstDueDate: planData.firstDueDate, approvedById: planData.approvedById }
            : null,
        },
      });

      return {
        invoiceId: invoice.id,
        number,
        customerName: customer.name,
        paymentType: payment.type,
        total: toDb(totals.total),
        amountPaid: toDb(amountPaid),
        balance: toDb(balance.isNegative() ? ZERO : balance),
        nextDueDate: planData?.firstDueDate ?? null,
        warrantyCardIds,
      };
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Someone else just changed this stock. Check the cart and try again.");
    }
    throw error;
  }
}

/** Lightweight lookup used by the POS success screen and later steps. */
export async function getInvoiceSummary(ctx: Ctx, id: string) {
  assertCan(ctx, "invoice.view");
  const invoice = await db.invoice.findUnique({
    where: { id },
    select: { id: true, number: true, branchId: true, total: true, amountPaid: true, balance: true, status: true, customer: { select: { name: true } } },
  });
  if (!invoice) throw new NotFoundError("That invoice no longer exists.");
  if (ctx.role !== "OWNER" && invoice.branchId !== ctx.branchId) throw new ForbiddenError("That invoice belongs to another branch.");
  return invoice;
}

// ─── Invoice list (read-only views; payments and returns arrive in later steps) ──

export type InvoiceListStatus = "PAID" | "PARTIALLY_PAID" | "UNPAID" | "OVERDUE" | "VOID" | "RETURNED";

export type InvoiceListRow = {
  id: string;
  number: string;
  customerName: string;
  customerPhone: string;
  branchCode: string;
  createdAt: string;
  paymentType: "FULL" | "INSTALLMENT";
  total: string;
  amountPaid: string;
  balance: string;
  displayStatus: InvoiceListStatus;
};

const LIST_PAGE_SIZE = 25;

/** Invoices with an instalment past due and not fully paid (the nightly job also marks these). */
function overdueWhere(today: Date): Prisma.InvoiceWhereInput {
  return {
    status: { in: ["UNPAID", "PARTIALLY_PAID"] },
    installmentPlan: { schedule: { some: { dueDate: { lt: today }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } } } },
  };
}

export async function listInvoices(
  ctx: Ctx,
  filters: { q?: string; status?: InvoiceListStatus; page?: number },
): Promise<{ rows: InvoiceListRow[]; total: number; page: number; pageSize: number; counts: Record<InvoiceListStatus | "ALL", number> }> {
  assertCan(ctx, "invoice.view");
  const branchId = ctx.role === "OWNER" ? ctx.activeBranchId : ctx.branchId;
  const today = toDbDate(todayInStoreTz());
  const q = filters.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const phoneFragment = digits.startsWith("0") ? digits.slice(1) : digits;
  const scope: Prisma.InvoiceWhereInput = {
    ...(branchId ? { branchId } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            ...(phoneFragment.length >= 3 ? [{ customer: { phoneE164: { contains: phoneFragment } } }] : []),
          ],
        }
      : {}),
  };
  const statusWhere: Prisma.InvoiceWhereInput =
    filters.status === "OVERDUE" ? overdueWhere(today) : filters.status ? { status: filters.status } : {};
  const where: Prisma.InvoiceWhereInput = { AND: [scope, statusWhere] };
  const page = Math.max(1, filters.page ?? 1);

  const [rows, total, grouped, overdueCount] = await Promise.all([
    db.invoice.findMany({
      where,
      select: {
        id: true,
        number: true,
        createdAt: true,
        paymentType: true,
        total: true,
        amountPaid: true,
        balance: true,
        status: true,
        customer: { select: { name: true, phoneE164: true } },
        branch: { select: { code: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
    }),
    db.invoice.count({ where }),
    db.invoice.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    db.invoice.count({ where: { AND: [scope, overdueWhere(today)] } }),
  ]);
  const overdueIds = new Set(
    (await db.invoice.findMany({ where: { AND: [{ id: { in: rows.map((r) => r.id) } }, overdueWhere(today)] }, select: { id: true } })).map((r) => r.id),
  );

  const counts: Record<InvoiceListStatus | "ALL", number> = { ALL: 0, PAID: 0, PARTIALLY_PAID: 0, UNPAID: 0, OVERDUE: overdueCount, VOID: 0, RETURNED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      customerName: r.customer.name,
      customerPhone: r.customer.phoneE164,
      branchCode: r.branch.code,
      createdAt: r.createdAt.toISOString(),
      paymentType: r.paymentType,
      total: r.total.toFixed(2),
      amountPaid: r.amountPaid.toFixed(2),
      balance: r.balance.toFixed(2),
      displayStatus: overdueIds.has(r.id) ? "OVERDUE" : r.status,
    })),
    total,
    page,
    pageSize: LIST_PAGE_SIZE,
    counts,
  };
}
