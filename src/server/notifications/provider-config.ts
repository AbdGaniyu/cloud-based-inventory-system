import "server-only";

import { z } from "zod";

import { db } from "@/server/db";
import { ProviderError } from "@/server/notifications/providers/types";
import { decryptSecret, encryptedValueSchema } from "@/server/secrets";

/**
 * Where provider credentials come from (invariant 14): an encrypted Setting row saved by the owner
 * in Settings → Messaging, or else the environment variable of the same name.
 */

export const WHATSAPP_PROVIDERS = ["whatsapp-cloud", "twilio", "console"] as const;
export const SMS_PROVIDERS = ["termii", "twilio", "console"] as const;
export type WhatsAppProviderName = (typeof WHATSAPP_PROVIDERS)[number];
export type SmsProviderName = (typeof SMS_PROVIDERS)[number];

export const PROVIDER_FIELDS = [
  { name: "WHATSAPP_CLOUD_PHONE_NUMBER_ID", label: "Phone number ID", provider: "whatsapp-cloud" },
  { name: "WHATSAPP_CLOUD_ACCESS_TOKEN", label: "Access token", provider: "whatsapp-cloud" },
  { name: "WHATSAPP_CLOUD_APP_SECRET", label: "App secret (webhook signatures)", provider: "whatsapp-cloud" },
  { name: "WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN", label: "Webhook verify token", provider: "whatsapp-cloud" },
  { name: "TWILIO_ACCOUNT_SID", label: "Account SID", provider: "twilio" },
  { name: "TWILIO_AUTH_TOKEN", label: "Auth token", provider: "twilio" },
  { name: "TWILIO_WHATSAPP_FROM", label: "WhatsApp sender", provider: "twilio" },
  { name: "TWILIO_SMS_FROM", label: "SMS sender", provider: "twilio" },
  { name: "TERMII_API_KEY", label: "API key", provider: "termii" },
  { name: "TERMII_SENDER_ID", label: "Sender ID", provider: "termii" },
  { name: "TERMII_WEBHOOK_TOKEN", label: "Webhook token", provider: "termii" },
] as const;
export type ProviderFieldName = (typeof PROVIDER_FIELDS)[number]["name"];

export const secretSettingKey = (name: ProviderFieldName) => `secret.${name}`;

export function isProviderField(name: string): name is ProviderFieldName {
  return PROVIDER_FIELDS.some((f) => f.name === name);
}

/** The stored (decrypted) value, or the environment's, or undefined. */
export async function readProviderValue(name: ProviderFieldName): Promise<{ value: string; source: "settings" | "env" } | undefined> {
  const row = await db.setting.findUnique({ where: { key: secretSettingKey(name) }, select: { value: true } });
  const parsed = row ? encryptedValueSchema.safeParse(row.value) : null;
  if (parsed?.success) {
    try {
      return { value: decryptSecret(parsed.data), source: "settings" };
    } catch (error) {
      console.error(`Stored ${name} could not be decrypted; falling back to the environment`, error);
    }
  }
  const env = process.env[name];
  return env ? { value: env, source: "env" } : undefined;
}

export async function requireProviderValue(name: ProviderFieldName): Promise<string> {
  const found = await readProviderValue(name);
  if (!found) throw new ProviderError(`${name} is not set (Settings → Messaging, or the environment)`);
  return found.value;
}

const choiceSchema = (allowed: readonly string[]) => z.string().refine((v) => allowed.includes(v));

/** Settings override the WHATSAPP_PROVIDER / SMS_PROVIDER environment variables; unknown values mean console. */
export async function providerChoice(): Promise<{ whatsapp: WhatsAppProviderName; sms: SmsProviderName; source: { whatsapp: "settings" | "env"; sms: "settings" | "env" } }> {
  const rows = await db.setting.findMany({ where: { key: { in: ["messaging.whatsappProvider", "messaging.smsProvider"] } }, select: { key: true, value: true } });
  const fromSettings = (key: string, allowed: readonly string[]) => {
    const parsed = choiceSchema(allowed).safeParse(rows.find((r) => r.key === key)?.value);
    return parsed.success ? parsed.data : undefined;
  };
  const wa = fromSettings("messaging.whatsappProvider", WHATSAPP_PROVIDERS);
  const sms = fromSettings("messaging.smsProvider", SMS_PROVIDERS);
  const envWa = process.env.WHATSAPP_PROVIDER;
  const envSms = process.env.SMS_PROVIDER;
  return {
    whatsapp: (wa ?? (WHATSAPP_PROVIDERS.find((p) => p === envWa) ?? "console")) as WhatsAppProviderName,
    sms: (sms ?? (SMS_PROVIDERS.find((p) => p === envSms) ?? "console")) as SmsProviderName,
    source: { whatsapp: wa ? "settings" : "env", sms: sms ? "settings" : "env" },
  };
}
