import "server-only";

import { STORE } from "@/config/store";
import { normalizePhone } from "@/lib/phone";
import { db } from "@/server/db";
import { resolveProviders } from "@/server/notifications/providers";
import type { MessageProvider } from "@/server/notifications/providers/types";
import { logEvent } from "@/server/ops/log";

/**
 * Operations alerts to the people who run the store, not customers: a webhook (Slack- or
 * Discord-compatible: ALERT_WEBHOOK_URL) and/or an SMS to ALERT_PHONE. Each kind goes out at most
 * once per hour; repeats in between are counted and mentioned in the next alert.
 */

export const ALERT_INTERVAL_MS = 60 * 60_000;
const WEBHOOK_TIMEOUT_MS = 10_000;

export type AlertDeps = { now?: Date; fetchImpl?: typeof fetch; sms?: MessageProvider };

export function alertChannels(env: Record<string, string | undefined> = process.env): { webhook: boolean; phone: string | null } {
  return { webhook: Boolean(env.ALERT_WEBHOOK_URL), phone: env.ALERT_PHONE ? normalizePhone(env.ALERT_PHONE) : null };
}

/** Claims the right to send this kind now (one per interval); false means "suppressed, counted". */
async function claim(kind: string, now: Date): Promise<{ ok: boolean; suppressed: number }> {
  const cutoff = new Date(now.getTime() - ALERT_INTERVAL_MS);
  const existing = await db.opsAlert.findUnique({ where: { kind } });
  if (!existing) {
    try {
      await db.opsAlert.create({ data: { kind, lastSentAt: now } });
      return { ok: true, suppressed: 0 };
    } catch {
      return { ok: false, suppressed: 0 };
    }
  }
  if (existing.lastSentAt > cutoff) {
    await db.opsAlert.update({ where: { kind }, data: { suppressed: { increment: 1 } } });
    return { ok: false, suppressed: existing.suppressed + 1 };
  }
  // Conditional update: two servers racing for the same alert send it once.
  const won = await db.opsAlert.updateMany({ where: { kind, lastSentAt: existing.lastSentAt }, data: { lastSentAt: now, suppressed: 0 } });
  return { ok: won.count === 1, suppressed: existing.suppressed };
}

/** Sends (or suppresses) one alert. Never throws: alerting must not break the thing it reports on. */
export async function sendOpsAlert(kind: string, title: string, details: string[] = [], deps: AlertDeps = {}): Promise<{ sent: boolean; channels: string[] }> {
  const now = deps.now ?? new Date();
  const channels = alertChannels();
  if (!channels.webhook && !channels.phone) {
    logEvent("warn", "ops alert (no channel configured)", { kind, title, details });
    return { sent: false, channels: [] };
  }
  try {
    const slot = await claim(kind, now);
    if (!slot.ok) return { sent: false, channels: [] };
    const extra = slot.suppressed > 0 ? [`(${slot.suppressed} more like this since the last alert)`] : [];
    const text = [`⚠️ ${STORE.name}: ${title}`, ...details, ...extra].join("\n");
    const sentTo: string[] = [];
    const url = process.env.ALERT_WEBHOOK_URL;
    if (url) {
      const res = await (deps.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.ok) sentTo.push("webhook");
      else logEvent("error", "ops alert webhook refused", { kind, status: res.status });
    }
    if (channels.phone) {
      const sms = deps.sms ?? (await resolveProviders()).sms;
      // SMS stays short and plain; the webhook carries the details.
      await sms.send({ to: channels.phone, body: `${STORE.name} alert: ${title}`.slice(0, 300) });
      sentTo.push("sms");
    }
    logEvent("warn", "ops alert sent", { kind, title, channels: sentTo });
    return { sent: sentTo.length > 0, channels: sentTo };
  } catch (error) {
    logEvent("error", "ops alert failed", { kind, title, error: error instanceof Error ? error.message : String(error) });
    return { sent: false, channels: [] };
  }
}
