import { randomUUID } from "node:crypto";

import type { MessageChannel, MessageProvider } from "@/server/notifications/providers/types";

/** Local development: prints the message instead of sending it, and reports it as sent. */
export function consoleProvider(channel: MessageChannel): MessageProvider {
  return {
    name: "console",
    channel,
    async send(msg) {
      const providerMessageId = `console-${randomUUID()}`;
      console.info(
        [`[${channel} → ${msg.to}] ${providerMessageId}`, msg.templateName ? `template: ${msg.templateName}` : null, msg.body, msg.mediaUrl ? `attachment: ${msg.mediaUrl}` : null]
          .filter(Boolean)
          .join("\n  "),
      );
      return { providerMessageId };
    },
  };
}
