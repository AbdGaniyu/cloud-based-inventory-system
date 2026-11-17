import "server-only";

import { after } from "next/server";

import { applyDeliveryUpdates } from "@/server/notifications";
import { type MessageProvider, ProviderError, WebhookAuthError } from "@/server/notifications/providers/types";

/**
 * Shared webhook handling: verify and parse synchronously (bad signatures get 401, missing config
 * 503), acknowledge at once, then apply status changes, including any SMS fallback, after responding.
 */
export async function handleDeliveryWebhook(provider: MessageProvider, request: Request): Promise<Response> {
  if (!provider.parseWebhook) return new Response("Not supported", { status: 404 });
  try {
    const updates = await provider.parseWebhook(request);
    if (updates.length > 0) {
      after(async () => {
        try {
          await applyDeliveryUpdates(provider.name, updates);
        } catch (error) {
          console.error(`Could not apply ${provider.name} delivery updates`, error);
        }
      });
    }
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof WebhookAuthError) return new Response("Invalid signature", { status: 401 });
    if (error instanceof ProviderError) {
      console.error(`${provider.name} webhook is not configured: ${error.message}`);
      return new Response("Not configured", { status: 503 });
    }
    if (error instanceof SyntaxError) return new Response("Malformed payload", { status: 400 });
    throw error;
  }
}
