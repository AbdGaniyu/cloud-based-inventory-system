import { consoleProvider } from "@/server/notifications/providers/console";
import { termiiProvider } from "@/server/notifications/providers/termii";
import { twilioProvider } from "@/server/notifications/providers/twilio";
import type { MessageProvider } from "@/server/notifications/providers/types";
import { whatsappCloudProvider } from "@/server/notifications/providers/whatsapp-cloud";

export type Providers = { whatsapp: MessageProvider; sms: MessageProvider };

/** Providers chosen by WHATSAPP_PROVIDER and SMS_PROVIDER (CLAUDE.md §9); unknown values fall back to console. */
export function providersFromEnv(): Providers {
  const whatsapp = process.env.WHATSAPP_PROVIDER;
  const sms = process.env.SMS_PROVIDER;
  return {
    whatsapp: whatsapp === "whatsapp-cloud" ? whatsappCloudProvider() : whatsapp === "twilio" ? twilioProvider("WHATSAPP") : consoleProvider("WHATSAPP"),
    sms: sms === "termii" ? termiiProvider() : sms === "twilio" ? twilioProvider("SMS") : consoleProvider("SMS"),
  };
}
