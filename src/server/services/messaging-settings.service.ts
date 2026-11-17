import "server-only";

import { STORE } from "@/config/store";
import { normalizePhone } from "@/lib/phone";
import type { UpdateTemplateInput } from "@/lib/validators/settings";
import { assertCan, type Ctx } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";
import { resolveProviders } from "@/server/notifications/providers";
import {
  isProviderField,
  PROVIDER_FIELDS,
  type ProviderFieldName,
  providerChoice,
  readProviderValue,
  secretSettingKey,
  type SmsProviderName,
  type WhatsAppProviderName,
} from "@/server/notifications/provider-config";
import { ProviderError } from "@/server/notifications/providers/types";
import { isTemplateKey, TEMPLATE_KEYS, TEMPLATE_LABELS, TEMPLATE_VARIABLES, type TemplateKey } from "@/server/notifications/templates";
import { encryptSecret, maskSecret } from "@/server/secrets";
import { writeAudit } from "@/server/services/audit.service";

/** Settings → Message templates and Messaging providers (owner only; DESIGN.md §5.11, invariant 14). */

export type TemplateRow = {
  key: TemplateKey;
  label: string;
  variables: readonly string[];
  body: string;
  smsBody: string | null;
  whatsappTemplateName: string | null;
  whatsappTemplateLanguage: string;
  isActive: boolean;
  updatedAt: string | null;
};

export async function listTemplates(ctx: Ctx): Promise<TemplateRow[]> {
  assertCan(ctx, "messaging.manage");
  const rows = await db.messageTemplate.findMany();
  return TEMPLATE_KEYS.map((key) => {
    const row = rows.find((r) => r.key === key);
    return {
      key,
      label: TEMPLATE_LABELS[key],
      variables: TEMPLATE_VARIABLES[key],
      body: row?.body ?? "",
      smsBody: row?.smsBody ?? null,
      whatsappTemplateName: row?.whatsappTemplateName ?? null,
      whatsappTemplateLanguage: row?.whatsappTemplateLanguage ?? "en",
      isActive: row?.isActive ?? false,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

/** {{names}} a body uses that this template does not provide: they would render empty. */
export function unknownVariables(key: TemplateKey, text: string): string[] {
  const allowed = new Set<string>(TEMPLATE_VARIABLES[key]);
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))].filter((v) => !allowed.has(v));
}

export async function updateTemplate(ctx: Ctx, input: UpdateTemplateInput): Promise<void> {
  assertCan(ctx, "messaging.manage");
  if (!isTemplateKey(input.key)) throw new NotFoundError("That template does not exist.");
  const key = input.key;
  const unknown = [...unknownVariables(key, input.body), ...unknownVariables(key, input.smsBody ?? "")];
  if (unknown.length > 0) {
    throw new ValidationError(`${[...new Set(unknown)].map((v) => `{{${v}}}`).join(", ")} is not available in this message. Use the variable chips.`, {
      body: ["Unknown variable"],
    });
  }
  const before = await db.messageTemplate.findUnique({ where: { key } });
  const data = {
    body: input.body,
    smsBody: input.smsBody ?? null,
    whatsappTemplateName: input.whatsappTemplateName ?? null,
    whatsappTemplateLanguage: input.whatsappTemplateLanguage,
    isActive: input.isActive,
    updatedById: ctx.userId,
  };
  await db.$transaction(async (tx) => {
    const saved = await tx.messageTemplate.upsert({ where: { key }, create: { key, name: TEMPLATE_LABELS[key], ...data }, update: data, select: { id: true } });
    await writeAudit(tx, {
      userId: ctx.userId,
      branchId: null,
      action: "template.update",
      entityType: "MessageTemplate",
      entityId: saved.id,
      before: before ? { body: before.body, smsBody: before.smsBody, whatsappTemplateName: before.whatsappTemplateName, isActive: before.isActive } : null,
      after: { key, body: data.body, smsBody: data.smsBody, whatsappTemplateName: data.whatsappTemplateName, isActive: data.isActive },
    });
  });
}

export type MessagingSetup = {
  whatsapp: { provider: WhatsAppProviderName; source: "settings" | "env" };
  sms: { provider: SmsProviderName; source: "settings" | "env" };
  fields: { name: ProviderFieldName; label: string; provider: string; source: "settings" | "env" | null; masked: string | null }[];
  webhooks: { whatsapp: string; twilio: string; termii: string };
};

/** Never returns a key in full: only where it comes from and its last four characters. */
export async function getMessagingSetup(ctx: Ctx): Promise<MessagingSetup> {
  assertCan(ctx, "messaging.manage");
  const [choice, values] = await Promise.all([providerChoice(), Promise.all(PROVIDER_FIELDS.map((f) => readProviderValue(f.name)))]);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    whatsapp: { provider: choice.whatsapp, source: choice.source.whatsapp },
    sms: { provider: choice.sms, source: choice.source.sms },
    fields: PROVIDER_FIELDS.map((f, i) => ({ name: f.name, label: f.label, provider: f.provider, source: values[i]?.source ?? null, masked: values[i] ? maskSecret(values[i].value) : null })),
    webhooks: { whatsapp: `${base}/api/webhooks/whatsapp`, twilio: `${base}/api/webhooks/twilio`, termii: `${base}/api/webhooks/termii?token=…` },
  };
}

export async function setProviderChoice(ctx: Ctx, input: { whatsapp: WhatsAppProviderName; sms: SmsProviderName }): Promise<void> {
  assertCan(ctx, "messaging.manage");
  const before = await providerChoice();
  await db.$transaction(async (tx) => {
    for (const [key, value] of [["messaging.whatsappProvider", input.whatsapp], ["messaging.smsProvider", input.sms]] as const) {
      await tx.setting.upsert({ where: { key }, create: { key, value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    }
    await writeAudit(tx, { userId: ctx.userId, branchId: null, action: "messaging.providers", entityType: "Setting", entityId: "messaging", before: { whatsapp: before.whatsapp, sms: before.sms }, after: input });
  });
}

/** Stores a provider key encrypted (isSecret); the audit row records only its last four characters. */
export async function saveProviderSecret(ctx: Ctx, input: { name: string; value: string }): Promise<{ masked: string }> {
  assertCan(ctx, "messaging.manage");
  if (!isProviderField(input.name)) throw new ValidationError("That is not a messaging setting.");
  const key = secretSettingKey(input.name);
  const value = encryptSecret(input.value);
  await db.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key }, create: { key, value, isSecret: true, updatedById: ctx.userId }, update: { value, isSecret: true, updatedById: ctx.userId } });
    await writeAudit(tx, { userId: ctx.userId, branchId: null, action: "messaging.secret.set", entityType: "Setting", entityId: key, after: { name: input.name, value: maskSecret(input.value) } });
  });
  return { masked: maskSecret(input.value) };
}

/** Removes the stored key; the environment variable (if any) applies again. */
export async function clearProviderSecret(ctx: Ctx, name: string): Promise<void> {
  assertCan(ctx, "messaging.manage");
  if (!isProviderField(name)) throw new ValidationError("That is not a messaging setting.");
  const key = secretSettingKey(name);
  await db.$transaction(async (tx) => {
    const removed = await tx.setting.deleteMany({ where: { key } });
    if (removed.count > 0) await writeAudit(tx, { userId: ctx.userId, branchId: null, action: "messaging.secret.clear", entityType: "Setting", entityId: key, after: { name } });
  });
}

/** Sends a plain test message straight through the configured provider (not logged against any customer). */
export async function sendTestMessage(ctx: Ctx, input: { channel: "WHATSAPP" | "SMS"; phone: string }): Promise<{ provider: string; providerMessageId: string }> {
  assertCan(ctx, "messaging.manage");
  const to = normalizePhone(input.phone);
  if (!to) throw new ValidationError("Enter a valid phone number.", { phone: ["Enter a valid phone number"] });
  const providers = await resolveProviders();
  const provider = input.channel === "WHATSAPP" ? providers.whatsapp : providers.sms;
  try {
    const result = await provider.send({ to, body: `${STORE.name}: this is a test message from Settings. No action needed.` });
    await db.$transaction((tx) =>
      writeAudit(tx, { userId: ctx.userId, branchId: null, action: "messaging.test", entityType: "Setting", entityId: "messaging", after: { channel: input.channel, provider: provider.name, to } }),
    );
    return { provider: provider.name, providerMessageId: result.providerMessageId };
  } catch (error) {
    const message = error instanceof ProviderError || error instanceof Error ? error.message : "The provider did not accept the message";
    throw new ValidationError(`${provider.name}: ${message}`);
  }
}
