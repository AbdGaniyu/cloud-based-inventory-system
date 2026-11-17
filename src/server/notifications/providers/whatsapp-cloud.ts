import { createHmac, timingSafeEqual } from "node:crypto";

import { requireProviderValue } from "@/server/notifications/provider-config";
import {
  type DeliveryUpdate,
  digitsOnly,
  type MessageProvider,
  type OutgoingMessage,
  providerFetch,
  WebhookAuthError,
} from "@/server/notifications/providers/types";

/**
 * Meta WhatsApp Cloud API. Business-initiated messages are sent as pre-approved templates with
 * named body parameters ({{customer_name}} …) and, for receipts and warranty cards, a document header.
 */

const DEFAULT_API_VERSION = "v23.0";

type GraphError = { error?: { message?: string; code?: number; error_data?: { details?: string } } };

function describeGraphError(body: unknown): string | undefined {
  const error = (body as GraphError | null)?.error;
  if (!error) return undefined;
  return [error.code ? `(#${error.code})` : null, error.error_data?.details ?? error.message].filter(Boolean).join(" ");
}

/** Template text parameters may not contain newlines, tabs or long runs of spaces. */
const cleanParam = (value: string) => value.replace(/\s+/g, " ").trim() || "-";

export function buildWhatsAppCloudPayload(msg: OutgoingMessage): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: digitsOnly(msg.to) };
  if (msg.templateName) {
    const components: Record<string, unknown>[] = [];
    if (msg.mediaUrl) {
      components.push({ type: "header", parameters: [{ type: "document", document: { link: msg.mediaUrl, filename: msg.mediaFilename ?? "document.pdf" } }] });
    }
    const variables = Object.entries(msg.variables ?? {});
    if (variables.length > 0) {
      components.push({ type: "body", parameters: variables.map(([name, text]) => ({ type: "text", parameter_name: name, text: cleanParam(text) })) });
    }
    return { ...base, type: "template", template: { name: msg.templateName, language: { code: msg.templateLanguage ?? "en" }, components } };
  }
  if (msg.mediaUrl) {
    return { ...base, type: "document", document: { link: msg.mediaUrl, filename: msg.mediaFilename ?? "document.pdf", caption: msg.body } };
  }
  return { ...base, type: "text", text: { body: msg.body, preview_url: true } };
}

type StatusPayload = {
  entry?: { changes?: { value?: { statuses?: { id: string; status: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }[] } }[] }[];
};

export function parseWhatsAppCloudStatuses(payload: unknown): DeliveryUpdate[] {
  const updates: DeliveryUpdate[] = [];
  for (const entry of (payload as StatusPayload | null)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (s.status === "sent") updates.push({ providerMessageId: s.id, status: "SENT" });
        else if (s.status === "delivered" || s.status === "read") updates.push({ providerMessageId: s.id, status: "DELIVERED" });
        else if (s.status === "failed") {
          const e = s.errors?.[0];
          updates.push({ providerMessageId: s.id, status: "FAILED", error: e ? `(#${e.code}) ${e.error_data?.details ?? e.message ?? e.title ?? "failed"}` : "Delivery failed" });
        }
      }
    }
  }
  return updates;
}

/** X-Hub-Signature-256 is "sha256=" + hex HMAC of the raw body with the app secret. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function whatsappCloudProvider(): MessageProvider {
  return {
    name: "whatsapp-cloud",
    channel: "WHATSAPP",
    async send(msg) {
      const version = process.env.WHATSAPP_CLOUD_API_VERSION || DEFAULT_API_VERSION;
      const url = `https://graph.facebook.com/${version}/${await requireProviderValue("WHATSAPP_CLOUD_PHONE_NUMBER_ID")}/messages`;
      const body = (await providerFetch(
        url,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await requireProviderValue("WHATSAPP_CLOUD_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildWhatsAppCloudPayload(msg)),
        },
        describeGraphError,
      )) as { messages?: { id: string }[] };
      const id = body?.messages?.[0]?.id;
      if (!id) throw new Error("WhatsApp accepted the message but returned no message ID");
      return { providerMessageId: id };
    },
    async parseWebhook(req) {
      const raw = await req.text();
      if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), await requireProviderValue("WHATSAPP_CLOUD_APP_SECRET"))) throw new WebhookAuthError();
      return parseWhatsAppCloudStatuses(JSON.parse(raw));
    },
  };
}
