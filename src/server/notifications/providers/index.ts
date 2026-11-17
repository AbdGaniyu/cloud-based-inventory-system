import { providerChoice } from "@/server/notifications/provider-config";
import { consoleProvider } from "@/server/notifications/providers/console";
import { termiiProvider } from "@/server/notifications/providers/termii";
import { twilioProvider } from "@/server/notifications/providers/twilio";
import type { MessageProvider } from "@/server/notifications/providers/types";
import { whatsappCloudProvider } from "@/server/notifications/providers/whatsapp-cloud";

export type Providers = { whatsapp: MessageProvider; sms: MessageProvider };

/** Providers chosen in Settings → Messaging, else WHATSAPP_PROVIDER / SMS_PROVIDER (CLAUDE.md §9); unknown means console. */
export async function resolveProviders(): Promise<Providers> {
  const choice = await providerChoice();
  return {
    whatsapp: choice.whatsapp === "whatsapp-cloud" ? whatsappCloudProvider() : choice.whatsapp === "twilio" ? twilioProvider("WHATSAPP") : consoleProvider("WHATSAPP"),
    sms: choice.sms === "termii" ? termiiProvider() : choice.sms === "twilio" ? twilioProvider("SMS") : consoleProvider("SMS"),
  };
}
