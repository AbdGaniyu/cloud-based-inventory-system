import { termiiProvider } from "@/server/notifications/providers/termii";
import { handleDeliveryWebhook } from "@/server/notifications/webhook";

/** Termii delivery reports; the URL carries ?token=TERMII_WEBHOOK_TOKEN. */
export async function POST(request: Request) {
  return handleDeliveryWebhook(termiiProvider(), request);
}
