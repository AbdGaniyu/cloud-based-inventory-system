import { verifyToken } from "@/server/notifications/providers/types";
import { whatsappCloudProvider } from "@/server/notifications/providers/whatsapp-cloud";
import { handleDeliveryWebhook } from "@/server/notifications/webhook";

/** Meta's one-time subscription check: echo hub.challenge when the verify token matches. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN;
  if (params.get("hub.mode") === "subscribe" && expected && verifyToken(params.get("hub.verify_token"), expected)) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Delivery status callbacks (sent / delivered / read / failed), signed with the app secret. */
export async function POST(request: Request) {
  return handleDeliveryWebhook(whatsappCloudProvider(), request);
}
