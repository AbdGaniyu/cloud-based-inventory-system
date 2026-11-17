import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { addDays, type CalendarDate, fromDbDate, todayInStoreTz, toDbDate } from "@/lib/dates";
import { money } from "@/lib/money";
import { db } from "@/server/db";
import { deliverMessages, type NotifyOptions, queueMessage } from "@/server/notifications";
import { firstName, messageDate, messageMoney, type TemplateKey } from "@/server/notifications/templates";
import { writeAudit } from "@/server/services/audit.service";
import { getSetting } from "@/server/services/settings.service";

/**
 * Instalment reminders and overdue escalation (CLAUDE.md §9). Each message is keyed
 * `{templateKey}:{scheduleId}:{offset}` (invariant 13), so a job that runs twice, or catches up
 * after a missed day, never sends the same reminder twice. Plans with reminders switched off,
 * settled rows and closed invoices are never messaged.
 */

export type JobOptions = NotifyOptions & { now?: Date; deadline?: number };

export type MessageJobSummary = {
  candidates: number;
  queued: number;
  alreadyQueued: number;
  notSent: number;
  delivered: number;
  deferred: number;
};

const CHUNK_SIZE = 200;
const MAX_CHUNKS = 50;
/** Leave headroom under the route's 300s limit; anything not sent by then is picked up by the retry job. */
const DELIVERY_BUDGET_MS = 240_000;
/** A missed run is caught up for this many extra days, inside windows that never overlap. */
const CATCH_UP_DAYS = 2;
const DEFAULT_INSTRUCTIONS = "Pay at any branch or by bank transfer, quoting your invoice number.";

const OPEN_INVOICE: Prisma.InvoiceWhereInput = { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, balance: { gt: 0 } };

type Rule = { templateKey: TemplateKey; offset: number; from: CalendarDate; to: CalendarDate };

const rowInclude = {
  plan: { select: { invoice: { select: { id: true, number: true, balance: true, customerId: true, customer: { select: { name: true } }, branch: { select: { name: true } } } } } },
} satisfies Prisma.InstallmentScheduleInclude;

async function queueForRule(rule: Rule, options: JobOptions, summary: MessageJobSummary, toDeliver: string[], instructions: string): Promise<void> {
  let cursor: string | undefined;
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const rows = await db.installmentSchedule.findMany({
      where: {
        status: { notIn: ["PAID", "WAIVED"] },
        dueDate: { gte: toDbDate(rule.from), lte: toDbDate(rule.to) },
        plan: { status: "ACTIVE", remindersEnabled: true, invoice: OPEN_INVOICE },
      },
      include: rowInclude,
      orderBy: { id: "asc" },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      summary.candidates++;
      const invoice = row.plan.invoice;
      try {
        const message = await queueMessage(
          {
            templateKey: rule.templateKey,
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            dedupeKey: `${rule.templateKey}:${row.id}:${rule.offset}`,
            variables: {
              customer_name: firstName(invoice.customer.name),
              amount_due: messageMoney(money(row.amountDue).minus(row.amountPaid).minus(row.amountWaived)),
              due_date: messageDate(fromDbDate(row.dueDate)),
              balance_remaining: messageMoney(invoice.balance),
              invoice_number: invoice.number,
              branch_name: invoice.branch.name,
              payment_instructions: instructions,
            },
          },
          options,
        );
        if (!message) summary.notSent++;
        else if (!message.created) summary.alreadyQueued++;
        else if (message.status === "SKIPPED") summary.notSent++;
        else {
          summary.queued++;
          toDeliver.push(message.id);
        }
      } catch (error) {
        console.error(`Could not queue ${rule.templateKey} for schedule row ${row.id}`, error);
      }
    }
    if (rows.length < CHUNK_SIZE) return;
    cursor = rows.at(-1)?.id;
  }
  console.warn(`${rule.templateKey}: stopped after ${MAX_CHUNKS} chunks; the rest go out on the next run`);
}

async function runRules(rules: Rule[], options: JobOptions): Promise<MessageJobSummary> {
  const summary: MessageJobSummary = { candidates: 0, queued: 0, alreadyQueued: 0, notSent: 0, delivered: 0, deferred: 0 };
  const instructions = await getSetting("payments.instructions", z.string(), DEFAULT_INSTRUCTIONS);
  const toDeliver: string[] = [];
  for (const rule of rules) await queueForRule(rule, options, summary, toDeliver, instructions);

  const deadline = options.deadline ?? Date.now() + DELIVERY_BUDGET_MS;
  for (const id of toDeliver) {
    if (Date.now() > deadline) {
      summary.deferred++;
      continue;
    }
    await deliverMessages([id], options);
    summary.delivered++;
  }
  return summary;
}

/** Daily 08:00: "due in 3 days" (caught up to the day before) and "due today". */
export async function runInstallmentReminders(options: JobOptions = {}): Promise<MessageJobSummary> {
  const today = todayInStoreTz(options.now ?? new Date());
  return runRules(
    [
      { templateKey: "installment_due_3d", offset: -3, from: addDays(today, 3 - CATCH_UP_DAYS), to: addDays(today, 3) },
      // "Due today" is only true today: never caught up.
      { templateKey: "installment_due_today", offset: 0, from: today, to: today },
    ],
    options,
  );
}

const ESCALATIONS: { templateKey: TemplateKey; days: number }[] = [
  { templateKey: "installment_overdue_1d", days: 1 },
  { templateKey: "installment_overdue_7d", days: 7 },
  { templateKey: "installment_overdue_14d", days: 14 },
];

/** Daily 09:00: marks past-due rows OVERDUE (audited), then sends the 1, 7 and 14-day escalations. */
export async function runOverdueEscalation(options: JobOptions = {}): Promise<MessageJobSummary & { markedOverdue: number }> {
  const today = todayInStoreTz(options.now ?? new Date());
  const markedOverdue = await db.$transaction(async (tx) => {
    const marked = await tx.installmentSchedule.updateMany({
      where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: toDbDate(today) }, plan: { invoice: { status: { notIn: ["VOID", "RETURNED"] } } } },
      data: { status: "OVERDUE" },
    });
    if (marked.count > 0) {
      await writeAudit(tx, {
        userId: null,
        branchId: null,
        action: "job.markOverdue",
        entityType: "JobRun",
        entityId: randomUUID(),
        after: { date: today, rowsMarkedOverdue: marked.count },
      });
    }
    return marked.count;
  });
  const summary = await runRules(
    ESCALATIONS.map(({ templateKey, days }) => ({ templateKey, offset: days, from: addDays(today, -days - CATCH_UP_DAYS), to: addDays(today, -days) })),
    options,
  );
  return { ...summary, markedOverdue };
}
