import { createHmac, timingSafeEqual } from "node:crypto";

import { requireProviderValue } from "@/server/notifications/provider-config";
import {
  type DeliveryUpdate,
  type MessageChannel,
  type MessageProvider,
  type OutgoingMessage,
  providerFetch,
  WebhookAuthError,
} from "@/server/notifications/providers/types";

/**
 * Twilio Programmable Messaging for WhatsApp and SMS. WhatsApp templates are Twilio Content
 * templates: set whatsappTemplateName to the Content SID (HX…). Their variables are positional
 * ("1", "2", …) in the order they appear in our template body; when a document is attached the
 * signed document URL is passed as one extra, final variable.
 */

export const TWILIO_WEBHOOK_PATH = "/api/webhooks/twilio";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const withWhatsAppPrefix = (n: string) => (n.startsWith("whatsapp:") ? n : `whatsapp:${n}`);

export function buildTwilioForm(channel: MessageChannel, msg: OutgoingMessage, from: string, statusCallback: string): URLSearchParams {
  const form = new URLSearchParams({
    To: channel === "WHATSAPP" ? withWhatsAppPrefix(msg.to) : msg.to,
    From: channel === "WHATSAPP" ? withWhatsAppPrefix(from) : from,
    StatusCallback: statusCallback,
  });
  if (channel === "WHATSAPP" && msg.templateName?.startsWith("HX")) {
    const values = Object.values(msg.variables ?? {});
    if (msg.mediaUrl) values.push(msg.mediaUrl);
    form.set("ContentSid", msg.templateName);
    form.set("ContentVariables", JSON.stringify(Object.fromEntries(values.map((v, i) => [String(i + 1), v]))));
  } else {
    form.set("Body", msg.body);
    if (channel === "WHATSAPP" && msg.mediaUrl) form.set("MediaUrl", msg.mediaUrl);
  }
  return form;
}

/** X-Twilio-Signature: base64 HMAC-SHA1 over the full URL followed by each POST param (sorted by name) as name+value. */
export function twilioSignature(authToken: string, url: string, params: Iterable<[string, string]>): string {
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHmac("sha1", authToken)
    .update(url + sorted.map(([k, v]) => k + v).join(""))
    .digest("base64");
}

export function verifyTwilioSignature(authToken: string, url: string, params: URLSearchParams, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params.entries()));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function parseTwilioStatus(params: URLSearchParams): DeliveryUpdate[] {
  const sid = params.get("MessageSid");
  const status = params.get("MessageStatus");
  if (!sid || !status) return [];
  if (status === "sent") return [{ providerMessageId: sid, status: "SENT" }];
  if (status === "delivered" || status === "read") return [{ providerMessageId: sid, status: "DELIVERED" }];
  if (status === "failed" || status === "undelivered") {
    const code = params.get("ErrorCode");
    return [{ providerMessageId: sid, status: "FAILED", error: [code ? `(#${code})` : null, params.get("ErrorMessage") ?? `Message ${status}`].filter(Boolean).join(" ") }];
  }
  return [];
}

export function twilioProvider(channel: MessageChannel): MessageProvider {
  return {
    name: "twilio",
    channel,
    async send(msg) {
      const sid = await requireProviderValue("TWILIO_ACCOUNT_SID");
      const from = await requireProviderValue(channel === "WHATSAPP" ? "TWILIO_WHATSAPP_FROM" : "TWILIO_SMS_FROM");
      const body = (await providerFetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${await requireProviderValue("TWILIO_AUTH_TOKEN")}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: buildTwilioForm(channel, msg, from, appUrl() + TWILIO_WEBHOOK_PATH),
        },
        (b) => {
          const e = b as { code?: number; message?: string } | null;
          return e?.message ? `${e.code ? `(#${e.code}) ` : ""}${e.message}` : undefined;
        },
      )) as { sid?: string };
      if (!body?.sid) throw new Error("Twilio accepted the message but returned no SID");
      return { providerMessageId: body.sid };
    },
    async parseWebhook(req) {
      const params = new URLSearchParams(await req.text());
      if (!verifyTwilioSignature(await requireProviderValue("TWILIO_AUTH_TOKEN"), appUrl() + TWILIO_WEBHOOK_PATH, params, req.headers.get("x-twilio-signature"))) {
        throw new WebhookAuthError();
      }
      return parseTwilioStatus(params);
    },
  };
}
