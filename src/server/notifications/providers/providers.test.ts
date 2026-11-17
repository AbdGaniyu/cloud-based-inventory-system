import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseTermiiReport } from "@/server/notifications/providers/termii";
import { buildTwilioForm, parseTwilioStatus, twilioSignature, verifyTwilioSignature } from "@/server/notifications/providers/twilio";
import { verifyToken } from "@/server/notifications/providers/types";
import { buildWhatsAppCloudPayload, parseWhatsAppCloudStatuses, verifyMetaSignature } from "@/server/notifications/providers/whatsapp-cloud";
import { firstName, messageMoney, renderTemplate, variablesInOrder } from "@/server/notifications/templates";

describe("templates", () => {
  it("renders variables, blanks unknown ones and tidies the spacing", () => {
    expect(renderTemplate("Hi {{customer_name}}, {{ amount }} due. {{missing}} Thanks", { customer_name: "Ada", amount: "NGN 5.00" })).toBe("Hi Ada, NGN 5.00 due. Thanks");
  });

  it("lists the variables a body uses in first-appearance order", () => {
    expect(variablesInOrder("{{b}} {{a}} {{b}} {{c}}", { a: "1", b: "2" })).toEqual({ b: "2", a: "1", c: "" });
  });

  it("formats money without the naira sign (keeps SMS in 160-character segments) and greets by first name", () => {
    expect(messageMoney("1343750")).toBe("NGN 1,343,750.00");
    expect(firstName("  Chioma  Eze ")).toBe("Chioma");
  });
});

describe("WhatsApp Cloud API", () => {
  it("sends a template with a document header and named, single-line parameters", () => {
    const payload = buildWhatsAppCloudPayload({
      to: "+2348031234567",
      body: "ignored for templates",
      mediaUrl: "https://x.test/inv.pdf",
      mediaFilename: "invoice.pdf",
      templateName: "gh_receipt",
      templateLanguage: "en",
      variables: { customer_name: "Ada", note: "line one\nline two" },
    });
    expect(payload).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "2348031234567",
      type: "template",
      template: {
        name: "gh_receipt",
        language: { code: "en" },
        components: [
          { type: "header", parameters: [{ type: "document", document: { link: "https://x.test/inv.pdf", filename: "invoice.pdf" } }] },
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "customer_name", text: "Ada" },
              { type: "text", parameter_name: "note", text: "line one line two" },
            ],
          },
        ],
      },
    });
  });

  it("sends plain text when no template is configured", () => {
    expect(buildWhatsAppCloudPayload({ to: "+2348031234567", body: "Hello" })).toMatchObject({ type: "text", text: { body: "Hello" } });
  });

  it("maps status callbacks, including read as delivered and the error detail on failure", () => {
    const updates = parseWhatsAppCloudStatuses({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.1", status: "delivered" },
                  { id: "wamid.2", status: "read" },
                  { id: "wamid.3", status: "failed", errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Not a WhatsApp user" } }] },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(updates).toEqual([
      { providerMessageId: "wamid.1", status: "DELIVERED" },
      { providerMessageId: "wamid.2", status: "DELIVERED" },
      { providerMessageId: "wamid.3", status: "FAILED", error: "(#131026) Not a WhatsApp user" },
    ]);
  });

  it("accepts only bodies signed with the app secret", () => {
    const body = '{"entry":[]}';
    const good = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, good, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body + " ", good, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
  });
});

describe("Twilio", () => {
  it("sends Content templates with positional variables and the document URL last", () => {
    const form = buildTwilioForm(
      "WHATSAPP",
      { to: "+2348031234567", body: "x", mediaUrl: "https://x.test/inv.pdf", templateName: "HX123", variables: { customer_name: "Ada", invoice_number: "INV-1" } },
      "+14155238886",
      "https://app.test/api/webhooks/twilio",
    );
    expect(form.get("To")).toBe("whatsapp:+2348031234567");
    expect(form.get("From")).toBe("whatsapp:+14155238886");
    expect(form.get("ContentSid")).toBe("HX123");
    expect(JSON.parse(form.get("ContentVariables") ?? "")).toEqual({ "1": "Ada", "2": "INV-1", "3": "https://x.test/inv.pdf" });
    expect(form.has("Body")).toBe(false);
  });

  it("sends SMS as plain body text without media", () => {
    const form = buildTwilioForm("SMS", { to: "+2348031234567", body: "Hello", mediaUrl: "https://x.test/a.pdf" }, "+15005550006", "https://app.test/cb");
    expect(form.get("To")).toBe("+2348031234567");
    expect(form.get("Body")).toBe("Hello");
    expect(form.has("MediaUrl")).toBe(false);
  });

  it("validates X-Twilio-Signature over the URL and sorted parameters", () => {
    const params = new URLSearchParams({ MessageStatus: "delivered", MessageSid: "SM1", AccountSid: "AC1" });
    const url = "https://app.test/api/webhooks/twilio";
    const expected = createHmac("sha1", "token").update(`${url}AccountSidAC1MessageSidSM1MessageStatusdelivered`).digest("base64");
    expect(twilioSignature("token", url, params.entries())).toBe(expected);
    expect(verifyTwilioSignature("token", url, params, expected)).toBe(true);
    params.set("MessageStatus", "failed");
    expect(verifyTwilioSignature("token", url, params, expected)).toBe(false);
  });

  it("maps message statuses", () => {
    expect(parseTwilioStatus(new URLSearchParams({ MessageSid: "SM1", MessageStatus: "read" }))).toEqual([{ providerMessageId: "SM1", status: "DELIVERED" }]);
    expect(parseTwilioStatus(new URLSearchParams({ MessageSid: "SM1", MessageStatus: "undelivered", ErrorCode: "30008" }))).toEqual([
      { providerMessageId: "SM1", status: "FAILED", error: "(#30008) Message undelivered" },
    ]);
    expect(parseTwilioStatus(new URLSearchParams({ MessageSid: "SM1", MessageStatus: "queued" }))).toEqual([]);
  });
});

describe("Termii", () => {
  it("maps delivery reports and checks the webhook token", () => {
    expect(parseTermiiReport({ message_id: "T1", status: "Delivered" })).toEqual([{ providerMessageId: "T1", status: "DELIVERED" }]);
    expect(parseTermiiReport({ message_id: "T2", status: "DND Active on Phone Number" })).toEqual([
      { providerMessageId: "T2", status: "FAILED", error: "DND Active on Phone Number" },
    ]);
    expect(parseTermiiReport({ status: "Delivered" })).toEqual([]);
    expect(verifyToken("abc", "abc")).toBe(true);
    expect(verifyToken("abd", "abc")).toBe(false);
    expect(verifyToken(null, "abc")).toBe(false);
  });
});
