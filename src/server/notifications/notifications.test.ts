import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { applyDeliveryUpdates, deliverMessage, OPTED_OUT_ERROR, queueMessage, type QueueRequest } from "@/server/notifications";
import type { Providers } from "@/server/notifications/providers";
import { type MessageChannel, type MessageProvider, type OutgoingMessage, ProviderError } from "@/server/notifications/providers/types";
import { resetDatabase } from "@/test/db";

type FakeProvider = MessageProvider & { sent: OutgoingMessage[]; failWith: string | null };

function fake(name: string, channel: MessageChannel): FakeProvider {
  const provider: FakeProvider = {
    name,
    channel,
    sent: [],
    failWith: null,
    async send(msg) {
      provider.sent.push(msg);
      if (provider.failWith) throw new ProviderError(provider.failWith);
      return { providerMessageId: `${name}-${provider.sent.length}` };
    },
  };
  return provider;
}

describe("notification engine", () => {
  let whatsapp: FakeProvider;
  let sms: FakeProvider;
  let providers: Providers;
  let customerId: string;

  const request = (overrides: Partial<QueueRequest> = {}): QueueRequest => ({
    templateKey: "receipt",
    customerId,
    dedupeKey: "receipt:invoice-1",
    variables: { customer_name: "Ada", invoice_number: "INV-IKJ-000001", invoice_total: "NGN 1,000.00", document_link: "https://x.test/doc" },
    mediaUrl: "https://x.test/doc",
    ...overrides,
  });

  async function setCustomer(optIns: { whatsappOptIn: boolean; smsOptIn: boolean }) {
    await db.customer.update({ where: { id: customerId }, data: optIns });
  }

  beforeEach(async () => {
    await resetDatabase();
    whatsapp = fake("wa", "WHATSAPP");
    sms = fake("sms", "SMS");
    providers = { whatsapp, sms };
    customerId = (await db.customer.create({ data: { name: "Ada Obi", phoneE164: "+2348031234567" } })).id;
    await db.messageTemplate.create({
      data: {
        key: "receipt",
        name: "Receipt",
        body: "Hi {{customer_name}}, invoice {{invoice_number}}: {{invoice_total}}. Receipt attached.",
        smsBody: "Gadget Hub: {{invoice_number}} {{invoice_total}}. Receipt: {{document_link}}",
        whatsappTemplateName: "gh_receipt",
      },
    });
  });

  it("queues a message once per dedupe key, so a job that runs twice sends once", async () => {
    const first = await queueMessage(request(), { providers });
    const second = await queueMessage(request(), { providers });
    expect(first?.created).toBe(true);
    expect(second).toMatchObject({ id: first?.id, created: false });
    expect(await db.notificationLog.count()).toBe(1);
  });

  it("sends on WhatsApp as the approved template with named variables and the document attached", async () => {
    const queued = await queueMessage(request(), { providers });
    expect(await deliverMessage(queued?.id ?? "", { providers })).toBe("SENT");
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]).toMatchObject({
      to: "+2348031234567",
      templateName: "gh_receipt",
      mediaUrl: "https://x.test/doc",
      variables: { customer_name: "Ada", invoice_number: "INV-IKJ-000001", invoice_total: "NGN 1,000.00" },
    });
    expect(Object.keys(whatsapp.sent[0].variables ?? {})).toEqual(["customer_name", "invoice_number", "invoice_total"]);
    const row = await db.notificationLog.findFirstOrThrow();
    expect(row).toMatchObject({ status: "SENT", provider: "wa", providerMessageId: "wa-1", attempts: 1 });
    expect(sms.sent).toHaveLength(0);
  });

  it("falls back to SMS with a link instead of an attachment when WhatsApp fails", async () => {
    whatsapp.failWith = "(#131026) Recipient is not a WhatsApp user";
    const queued = await queueMessage(request(), { providers });
    expect(await deliverMessage(queued?.id ?? "", { providers })).toBe("FAILED");

    const rows = await db.notificationLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ channel: "WHATSAPP", status: "FAILED", error: "(#131026) Recipient is not a WhatsApp user" });
    expect(rows[1]).toMatchObject({ channel: "SMS", status: "SENT", parentId: rows[0].id, dedupeKey: "receipt:invoice-1:SMS", mediaUrl: null });
    expect(sms.sent[0].body).toBe("Gadget Hub: INV-IKJ-000001 NGN 1,000.00. Receipt: https://x.test/doc");
    expect(sms.sent[0].mediaUrl).toBeUndefined();

    // A retry of the failed WhatsApp row never sends a second SMS.
    await deliverMessage(rows[0].id, { providers });
    expect(sms.sent).toHaveLength(1);
  });

  it("goes straight to SMS when the customer opted out of WhatsApp, and skips (logged) when opted out of both", async () => {
    await setCustomer({ whatsappOptIn: false, smsOptIn: true });
    const viaSms = await queueMessage(request(), { providers });
    expect(viaSms?.channel).toBe("SMS");
    await deliverMessage(viaSms?.id ?? "", { providers });
    expect(whatsapp.sent).toHaveLength(0);
    expect(sms.sent[0].body).toContain("Receipt: https://x.test/doc");

    await setCustomer({ whatsappOptIn: false, smsOptIn: false });
    const skipped = await queueMessage(request({ dedupeKey: "receipt:invoice-2" }), { providers });
    expect(skipped?.status).toBe("SKIPPED");
    expect(await deliverMessage(skipped?.id ?? "", { providers })).toBe("SKIPPED");
    expect(await db.notificationLog.findUniqueOrThrow({ where: { id: skipped?.id } })).toMatchObject({ error: OPTED_OUT_ERROR, provider: "none" });
    expect(whatsapp.sent.length + sms.sent.length).toBe(1);
  });

  it("does not fall back to SMS for a customer who opted out of SMS", async () => {
    await setCustomer({ whatsappOptIn: true, smsOptIn: false });
    whatsapp.failWith = "Provider did not respond in time";
    const queued = await queueMessage(request(), { providers });
    await deliverMessage(queued?.id ?? "", { providers });
    expect(await db.notificationLog.count()).toBe(1);
    expect(sms.sent).toHaveLength(0);
  });

  it("claims each attempt so two workers cannot send the same row twice", async () => {
    const queued = await queueMessage(request(), { providers });
    await Promise.all([deliverMessage(queued?.id ?? "", { providers }), deliverMessage(queued?.id ?? "", { providers })]);
    expect(whatsapp.sent).toHaveLength(1);
    await deliverMessage(queued?.id ?? "", { providers });
    expect(whatsapp.sent).toHaveLength(1);
  });

  it("stops retrying after the maximum number of attempts", async () => {
    await setCustomer({ whatsappOptIn: true, smsOptIn: false });
    whatsapp.failWith = "Rate limited";
    const queued = await queueMessage(request(), { providers });
    for (let i = 0; i < 5; i++) await deliverMessage(queued?.id ?? "", { providers });
    expect(whatsapp.sent).toHaveLength(3);
    expect(await db.notificationLog.findUniqueOrThrow({ where: { id: queued?.id } })).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("returns null and writes nothing when the template is switched off", async () => {
    await db.messageTemplate.update({ where: { key: "receipt" }, data: { isActive: false } });
    expect(await queueMessage(request(), { providers })).toBeNull();
    expect(await db.notificationLog.count()).toBe(0);
  });

  it("applies webhook updates forward only, and falls back to SMS when WhatsApp fails after acceptance", async () => {
    const queued = await queueMessage(request(), { providers });
    await deliverMessage(queued?.id ?? "", { providers });

    expect(await applyDeliveryUpdates("wa", [{ providerMessageId: "wa-1", status: "DELIVERED" }], { providers })).toBe(1);
    expect(await applyDeliveryUpdates("wa", [{ providerMessageId: "wa-1", status: "SENT" }], { providers })).toBe(0);
    expect(await applyDeliveryUpdates("other", [{ providerMessageId: "wa-1", status: "FAILED" }], { providers })).toBe(0);
    expect((await db.notificationLog.findFirstOrThrow()).status).toBe("DELIVERED");

    const second = await queueMessage(request({ dedupeKey: "receipt:invoice-2" }), { providers });
    await deliverMessage(second?.id ?? "", { providers });
    await applyDeliveryUpdates("wa", [{ providerMessageId: "wa-2", status: "FAILED", error: "(#131049) Not delivered to maintain healthy ecosystem engagement" }], {
      providers,
    });
    const fallback = await db.notificationLog.findFirstOrThrow({ where: { parentId: second?.id } });
    expect(fallback).toMatchObject({ channel: "SMS", status: "SENT" });
    expect(await db.notificationLog.findUniqueOrThrow({ where: { id: second?.id } })).toMatchObject({ status: "FAILED" });
  });
});
