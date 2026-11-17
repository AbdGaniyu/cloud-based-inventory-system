import { timingSafeEqual } from "node:crypto";

export type MessageChannel = "WHATSAPP" | "SMS";

export type OutgoingMessage = {
  /** E.164, e.g. "+2348031234567". */
  to: string;
  body: string;
  /** Public (signed) URL of a document to attach. WhatsApp only. */
  mediaUrl?: string;
  mediaFilename?: string;
  /** Pre-approved WhatsApp template; business-initiated messages need one outside the 24-hour window. */
  templateName?: string;
  templateLanguage?: string;
  /** Template variables in the order they first appear in the template body. */
  variables?: Record<string, string>;
};

export type DeliveryUpdate = {
  providerMessageId: string;
  status: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
};

export interface MessageProvider {
  name: string;
  channel: MessageChannel;
  send(msg: OutgoingMessage): Promise<{ providerMessageId: string }>;
  parseWebhook?(req: Request): Promise<DeliveryUpdate[]>;
}

/** A provider refused or failed the message. The message text is stored on the log row for staff to read. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Rejects a webhook that fails signature or token checks. */
export class WebhookAuthError extends Error {
  constructor(message = "Webhook signature is not valid") {
    super(message);
    this.name = "WebhookAuthError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/** fetch with a timeout; non-2xx responses become ProviderError with the provider's own message when it has one. */
export async function providerFetch(url: string, init: RequestInit, describeError: (body: unknown) => string | undefined): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new ProviderError(error instanceof Error && error.name === "TimeoutError" ? "Provider did not respond in time" : "Could not reach the provider");
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error pages are reported by status code below.
  }
  if (!response.ok) throw new ProviderError(describeError(body) ?? `Provider returned HTTP ${response.status}`);
  return body;
}

/** "+2348031234567" → "2348031234567" (WhatsApp Cloud and Termii take digits only). */
export function digitsOnly(e164: string): string {
  return e164.replace(/\D/g, "");
}

/** Constant-time comparison for shared-secret tokens in webhook URLs and verify handshakes. */
export function verifyToken(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
