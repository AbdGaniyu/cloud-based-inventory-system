import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { providerChoice, readProviderValue } from "@/server/notifications/provider-config";
import { createBranch, createUser, getBusinessSettings, resetUserPassword, updateBranch, updateBusinessSettings, updateUser } from "@/server/services/admin.service";
import { listAuditLogs, redactCosts } from "@/server/services/audit-log.service";
import { checkCredentials } from "@/server/services/auth.service";
import { listNotifications } from "@/server/services/message.service";
import { clearProviderSecret, getMessagingSetup, saveProviderSecret, setProviderChoice, updateTemplate } from "@/server/services/messaging-settings.service";
import { ctxFor, makeBranch, makeUser, resetDatabase } from "@/test/db";

describe("settings, audit log and notification centre", () => {
  let f: Awaited<ReturnType<typeof setup>>;

  async function setup() {
    await resetDatabase();
    const ikeja = await makeBranch({ code: "IKJ" });
    const lekki = await makeBranch({ code: "LEK" });
    const owner = await makeUser("OWNER", null);
    const manager = await makeUser("BRANCH_MANAGER", ikeja.id);
    const cashier = await makeUser("CASHIER", ikeja.id);
    return { ikeja, lekki, owner, manager, cashier, o: ctxFor(owner, null) };
  }

  beforeEach(async () => {
    f = await setup();
  });

  it("saves only changed business settings, audited, and only for the owner", async () => {
    const current = await getBusinessSettings(f.o);
    await expect(updateBusinessSettings(ctxFor(f.manager), { ...current, vatRatePercent: "10" })).rejects.toBeInstanceOf(ForbiddenError);
    await updateBusinessSettings(f.o, { ...current, vatRatePercent: "10", returnWindowDays: 14 });
    expect(await getBusinessSettings(f.o)).toMatchObject({ vatRatePercent: "10", returnWindowDays: 14 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "settings.update" } });
    expect(audit.after).toEqual({ "tax.vatRatePercent": "10", "returns.windowDays": 14 });
  });

  it("creates branches with a unique code and will not close one that still has staff", async () => {
    await expect(createBranch(f.o, { name: "Duplicate", code: "IKJ", type: "STORE", address: "1 Allen Avenue", phone: "08025550102", email: "" })).rejects.toBeInstanceOf(ValidationError);
    const vi = await createBranch(f.o, { name: "Victoria Island", code: "VI", type: "STORE", address: "2 Adeola Odeku", phone: "08025550109", email: "vi@gadgethub.test" });
    expect(await db.branch.findUniqueOrThrow({ where: { id: vi.id } })).toMatchObject({ code: "VI", phone: "+2348025550109" });
    const ikeja = await db.branch.findUniqueOrThrow({ where: { id: f.ikeja.id } });
    await expect(updateBranch(f.o, { id: ikeja.id, name: ikeja.name, type: ikeja.type, address: ikeja.address, phone: "08025550102", email: "", isActive: false })).rejects.toBeInstanceOf(ConflictError);
  });

  it("manages users: hashed passwords, branch placement, at least one owner, no self-demotion", async () => {
    const created = await createUser(f.o, { name: "Ngozi Umeh", email: "ngozi@gadgethub.test", role: "CASHIER", branchId: f.lekki.id, password: "Lekki!Shop2026" });
    const row = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.passwordHash).not.toContain("Lekki");
    expect(await checkCredentials({ email: "ngozi@gadgethub.test", password: "Lekki!Shop2026" })).toMatchObject({ id: created.id });
    await expect(createUser(f.o, { name: "No Branch", email: "nb@gadgethub.test", role: "CASHIER", password: "Password!2026" })).rejects.toThrow("Choose the branch");
    await expect(updateUser(f.o, { id: f.owner.id, name: f.owner.name, role: "OWNER", isActive: false })).rejects.toThrow("your own role");
    const second = await createUser(f.o, { name: "Second Owner", email: "owner2@gadgethub.test", role: "OWNER", password: "Owner!Two2026" });
    await updateUser(ctxFor({ id: second.id, role: "OWNER", branchId: null }, null), { id: f.owner.id, name: f.owner.name, role: "OWNER", isActive: false });
    await expect(updateUser(f.o, { id: second.id, name: "Second Owner", role: "CASHIER", branchId: f.ikeja.id, isActive: true })).rejects.toBeInstanceOf(ConflictError);

    await db.authThrottle.create({ data: { key: "login:email:ngozi@gadgethub.test", failures: 5, windowStartedAt: new Date(), lockedUntil: new Date(Date.now() + 600_000) } });
    await resetUserPassword(ctxFor({ id: second.id, role: "OWNER", branchId: null }, null), { id: created.id, password: "Brand!New2026x" });
    expect(await db.authThrottle.count()).toBe(0);
    expect(await checkCredentials({ email: "ngozi@gadgethub.test", password: "Brand!New2026x" })).toMatchObject({ id: created.id });
    expect(JSON.stringify(await db.auditLog.findMany({ where: { action: "user.resetPassword" } }))).not.toContain("Brand!New");
  });

  it("rejects template variables a message cannot fill", async () => {
    const base = { key: "receipt", smsBody: undefined, whatsappTemplateName: "gh_receipt", whatsappTemplateLanguage: "en", isActive: true };
    await expect(updateTemplate(f.o, { ...base, body: "Hi {{customer_name}}, due {{due_date}}" })).rejects.toThrow("{{due_date}}");
    await updateTemplate(f.o, { ...base, body: "Hi {{customer_name}}, thanks for invoice {{invoice_number}}." });
    expect((await db.messageTemplate.findUniqueOrThrow({ where: { key: "receipt" } })).body).toBe("Hi {{customer_name}}, thanks for invoice {{invoice_number}}.");
  });

  it("stores provider keys encrypted, shows only the last four, and falls back to the environment when cleared", async () => {
    await saveProviderSecret(f.o, { name: "TERMII_API_KEY", value: "TL-live-key-5521" });
    const stored = await db.setting.findUniqueOrThrow({ where: { key: "secret.TERMII_API_KEY" } });
    expect(stored.isSecret).toBe(true);
    expect(JSON.stringify(stored.value)).not.toContain("live-key");
    expect(await readProviderValue("TERMII_API_KEY")).toEqual({ value: "TL-live-key-5521", source: "settings" });
    const setup = await getMessagingSetup(f.o);
    expect(setup.fields.find((x) => x.name === "TERMII_API_KEY")).toMatchObject({ source: "settings", masked: "••••5521" });
    expect(JSON.stringify(setup)).not.toContain("live-key");
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("live-key");
    await clearProviderSecret(f.o, "TERMII_API_KEY");
    expect((await readProviderValue("TERMII_API_KEY"))?.source ?? null).not.toBe("settings");
    await expect(saveProviderSecret(f.o, { name: "DATABASE_URL", value: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getMessagingSetup(ctxFor(f.manager))).rejects.toBeInstanceOf(ForbiddenError);

    await setProviderChoice(f.o, { whatsapp: "twilio", sms: "termii" });
    expect(await providerChoice()).toMatchObject({ whatsapp: "twilio", sms: "termii", source: { whatsapp: "settings", sms: "settings" } });
  });

  it("shows managers their own branch's audit trail without cost figures; cashiers none", async () => {
    await db.auditLog.createMany({
      data: [
        { userId: f.manager.id, branchId: f.ikeja.id, action: "intake.create", entityType: "PurchaseOrder", entityId: "po-1", after: { number: "PO-IKJ-000001", totalCost: "900000.00", lines: [{ unitCost: "300000.00", quantity: 3 }] } },
        { userId: f.owner.id, branchId: f.lekki.id, action: "payment.record", entityType: "CustomerPayment", entityId: "p-1", after: { invoiceNumber: "INV-LEK-000001", amount: "50000.00" } },
      ],
    });
    const mine = await listAuditLogs(ctxFor(f.manager), {});
    expect(mine.rows.map((r) => r.action)).toEqual(["intake.create"]);
    expect(mine.rows[0].after).toEqual({ number: "PO-IKJ-000001", lines: [{ quantity: 3 }] });
    const all = await listAuditLogs(f.o, { action: "payment." });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0].summary).toBe("INV-LEK-000001 · ₦50,000.00");
    expect((await listAuditLogs(f.o, { q: "PO-IKJ-000001" })).rows[0].after).toMatchObject({ totalCost: "900000.00" });
    await expect(listAuditLogs(ctxFor(f.cashier), {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(redactCosts({ unitCost: 1, nested: { profitMargin: 2, keep: 3 } })).toEqual({ nested: { keep: 3 } });
  });

  it("lists notifications for the branch with status counts", async () => {
    const customer = await db.customer.create({ data: { name: "Ada Obi", phoneE164: "+2348031234567" } });
    const invoiceFor = async (branchId: string, number: string) =>
      db.invoice.create({
        data: { number, branchId, customerId: customer.id, cashierId: f.cashier.id, subtotal: "100", taxRate: "0", taxAmount: "0", total: "100", balance: "0", amountPaid: "100", paymentType: "FULL", status: "PAID" },
      });
    const ikj = await invoiceFor(f.ikeja.id, "INV-IKJ-000001");
    const lek = await invoiceFor(f.lekki.id, "INV-LEK-000001");
    const log = (invoiceId: string, status: "SENT" | "FAILED", key: string) =>
      ({ customerId: customer.id, invoiceId, templateKey: "receipt", channel: "WHATSAPP" as const, provider: "console", to: customer.phoneE164, body: "Hi", status, dedupeKey: key });
    await db.notificationLog.createMany({ data: [log(ikj.id, "SENT", "a"), log(ikj.id, "FAILED", "b"), log(lek.id, "SENT", "c")] });
    const manager = await listNotifications(ctxFor(f.manager), {});
    expect(manager.counts).toMatchObject({ ALL: 2, SENT: 1, FAILED: 1 });
    expect((await listNotifications(ctxFor(f.manager), { status: "FAILED" })).rows.map((r) => r.invoice?.number)).toEqual(["INV-IKJ-000001"]);
    expect((await listNotifications(f.o, { q: "LEK" })).total).toBe(1);
  });
});
