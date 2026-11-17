import { twilioProvider } from "@/server/notifications/providers/twilio";
import { handleDeliveryWebhook } from "@/server/notifications/webhook";

/** Twilio StatusCallback for WhatsApp and SMS, verified with X-Twilio-Signature. */
export async function POST(request: Request) {
  return handleDeliveryWebhook(twilioProvider("SMS"), request);
}
