import { requireProviderValue } from "@/server/notifications/provider-config";
import {
  type DeliveryUpdate,
  digitsOnly,
  type MessageProvider,
  providerFetch,
  verifyToken,
  WebhookAuthError,
} from "@/server/notifications/providers/types";

/**
 * Termii SMS (Nigeria). Uses the "generic" route; switch TERMII_CHANNEL to "dnd" to reach numbers
 * on the Do-Not-Disturb list once Termii has approved the sender ID for it.
 * Delivery reports: set the webhook URL in the Termii dashboard to
 * {APP_URL}/api/webhooks/termii?token={TERMII_WEBHOOK_TOKEN}.
 */

const DEFAULT_BASE_URL = "https://api.ng.termii.com";

type TermiiReport = { message_id?: string; status?: string };

export function parseTermiiReport(payload: unknown): DeliveryUpdate[] {
  const report = payload as TermiiReport | null;
  if (!report?.message_id || !report.status) return [];
  const status = report.status.toLowerCase();
  if (status === "delivered") return [{ providerMessageId: report.message_id, status: "DELIVERED" }];
  if (status === "sent") return [{ providerMessageId: report.message_id, status: "SENT" }];
  if (status.includes("fail") || status.includes("dnd") || status.includes("rejected") || status.includes("expired")) {
    return [{ providerMessageId: report.message_id, status: "FAILED", error: report.status }];
  }
  return [];
}

export function termiiProvider(): MessageProvider {
  return {
    name: "termii",
    channel: "SMS",
    async send(msg) {
      const base = (process.env.TERMII_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
      const body = (await providerFetch(
        `${base}/api/sms/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: await requireProviderValue("TERMII_API_KEY"),
            from: await requireProviderValue("TERMII_SENDER_ID"),
            to: digitsOnly(msg.to),
            sms: msg.body,
            type: "plain",
            channel: process.env.TERMII_CHANNEL || "generic",
          }),
        },
        (b) => (b as { message?: string } | null)?.message,
      )) as { message_id?: string; code?: string; message?: string };
      if (!body?.message_id) throw new Error(body?.message ?? "Termii returned no message ID");
      return { providerMessageId: body.message_id };
    },
    async parseWebhook(req) {
      if (!verifyToken(new URL(req.url).searchParams.get("token"), await requireProviderValue("TERMII_WEBHOOK_TOKEN"))) throw new WebhookAuthError();
      return parseTermiiReport(await req.json());
    },
  };
}
