import { expect, type Page, test } from "@playwright/test";

/**
 * Checkout smoke test (CLAUDE.md §13) against freshly seeded data: a cashier sells a device and an
 * accessory, the receipt goes out, the invoice and its PDF exist, and the device leaves the shelf.
 */

const PASSWORD = process.env.SEED_PASSWORD || "GadgetHub!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

test("a cashier sells a device and an accessory and the documents follow", async ({ page }) => {
  await signIn(page, "cashier.ikj@gadgethub.test");
  await page.goto("/pos");

  const search = page.getByLabel("Scan IMEI or barcode, or search products");
  await expect(search).toBeFocused();

  // First in-stock device and accessory at Ikeja.
  const device = page.getByRole("button", { name: /— add to cart$/ }).first();
  const deviceLabel = (await device.getAttribute("aria-label")) ?? "";
  const imei = deviceLabel.match(/(\d{15}|[A-Z0-9]{8,})\s+— add to cart$/)?.[1] ?? "";
  expect(imei, `IMEI or serial in "${deviceLabel}"`).not.toBe("");
  await device.click();
  await page.getByRole("button", { name: /— add one$/ }).first().click();
  const cart = page.getByRole("list", { name: "Cart" });
  await expect(cart.getByRole("listitem")).toHaveCount(2);
  await expect(cart.getByText(imei)).toBeVisible();

  // Customer (F4), then pay the total in one bank transfer.
  await page.keyboard.press("F4");
  await page.getByPlaceholder("Name or phone number").fill("Adaeze");
  await page.getByRole("option", { name: /Adaeze Okafor/ }).click();
  const total = (await page.locator(".text-pos-total").innerText()).replace(/[^\d.]/g, "");
  expect(Number(total)).toBeGreaterThan(0);
  await page.getByLabel("Payment 1 amount").fill(total);
  await page.getByLabel("Payment 1 reference").fill("SMOKE-001");

  // Complete (F9).
  await page.keyboard.press("F9");
  await expect(page.getByText("Sale completed")).toBeVisible({ timeout: 15_000 });
  const number = (await page.locator("p.font-mono").first().innerText()).trim();
  expect(number).toMatch(/^INV-IKJ-\d{6}$/);

  // Receipt and warranty messages go out through the console provider.
  const chips = page.getByRole("list", { name: "Messages to the customer" });
  await expect(chips).toContainText("Receipt · WhatsApp");
  await expect(chips).not.toContainText("Queued", { timeout: 20_000 });

  // The invoice exists, is paid, and its PDF renders.
  await page.getByRole("link", { name: "View invoice" }).click();
  await expect(page.getByRole("heading", { name: `Invoice ${number}` })).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  const invoiceId = page.url().split("/invoices/")[1] ?? "";
  const pdf = await page.request.get(`/api/pdf/invoice/${invoiceId}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  // The sold device can no longer be added at the POS.
  await page.goto("/pos");
  await page.getByLabel("Scan IMEI or barcode, or search products").fill(imei);
  await expect(page.getByRole("button", { name: new RegExp(`${imei} — add to cart$`) })).toHaveCount(0);
});

test("a cashier cannot reach owner screens or see cost data", async ({ page }) => {
  await signIn(page, "cashier.ikj@gadgethub.test");
  await page.goto("/settings");
  await page.waitForURL(/\/dashboard/);
  await page.goto("/ledger/payables");
  await page.waitForURL(/\/dashboard/);
  await page.goto("/inventory");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /cost/i })).toHaveCount(0);
});
