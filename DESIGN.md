# DESIGN.md

Design system and screen specifications for the Gadget Store Multi-Branch Inventory, POS and Credit Ledger system. Build rules and domain logic are in `CLAUDE.md`. If the two conflict, `CLAUDE.md` wins on behaviour and this file wins on appearance.

## 1. Direction

A clean, high-contrast, modern SaaS dashboard in the spirit of Linear and Stripe: quiet surfaces, sharp type, dense but calm data, colour used only to carry meaning.

Two modes of use shape every decision:

- **Back office (desktop, 1280px+):** owners and managers reading tables, ledgers and reports. Optimise for density and scanning.
- **Counter (tablet landscape, 1024px, touch + barcode scanner):** cashiers completing a sale in seconds with a customer waiting. Optimise for large targets, few steps and zero ambiguity.

Principles:

1. **Numbers first.** Money, quantities and IMEIs are the content. Give them the best type, alignment and contrast on the screen.
2. **Status at a glance.** Every invoice, unit, transfer and message has one status and one badge. Same word, same colour, everywhere.
3. **One primary action per screen.** Everything else is secondary or tucked into a menu.
4. **Colour means something.** Neutral UI; colour is reserved for status, alerts and the single primary action.
5. **Scope is always visible.** The user can always see which branch they are looking at.

## 2. Design tokens

Implement as CSS variables in `globals.css` using the shadcn/ui convention, in both light and dark themes. Light is the default; dark is supported for back-office use.

### 2.1 Colour — light

| Token | Hex | Use |
|---|---|---|
| `--background` | `#FFFFFF` | Page |
| `--surface` | `#FAFAFA` | Sidebar, table header, subtle panels |
| `--card` | `#FFFFFF` | Cards |
| `--border` | `#E4E4E7` | Hairlines, dividers, inputs |
| `--border-strong` | `#D4D4D8` | Input hover, emphasised dividers |
| `--foreground` | `#09090B` | Primary text, key figures |
| `--muted-foreground` | `#52525B` | Secondary text, labels |
| `--subtle-foreground` | `#71717A` | Placeholders, tertiary meta |
| `--primary` | `#4F46E5` | Primary buttons, active nav, focus ring, links |
| `--primary-hover` | `#4338CA` | |
| `--primary-foreground` | `#FFFFFF` | |
| `--accent` | `#EEF2FF` | Selected row, active nav background |

### 2.2 Colour — dark

| Token | Hex |
|---|---|
| `--background` | `#09090B` |
| `--surface` | `#111113` |
| `--card` | `#18181B` |
| `--border` | `#27272A` |
| `--border-strong` | `#3F3F46` |
| `--foreground` | `#FAFAFA` |
| `--muted-foreground` | `#A1A1AA` |
| `--subtle-foreground` | `#71717A` |
| `--primary` | `#818CF8` |
| `--primary-foreground` | `#09090B` |
| `--accent` | `#1E1B4B` |

### 2.3 Semantic colour

Each has a text colour, a tinted background and a border, used together in badges and alert banners.

| Meaning | Text | Background | Border |
|---|---|---|---|
| Success | `#15803D` | `#F0FDF4` | `#BBF7D0` |
| Warning | `#B45309` | `#FFFBEB` | `#FDE68A` |
| Danger | `#B91C1C` | `#FEF2F2` | `#FECACA` |
| Info | `#1D4ED8` | `#EFF6FF` | `#BFDBFE` |
| Neutral | `#3F3F46` | `#F4F4F5` | `#E4E4E7` |

Dark theme equivalents:

| Meaning | Text | Background | Border |
|---|---|---|---|
| Success | `#4ADE80` | `#052E16` | `#166534` |
| Warning | `#FBBF24` | `#422006` | `#92400E` |
| Danger | `#F87171` | `#450A0A` | `#991B1B` |
| Info | `#60A5FA` | `#172554` | `#1E40AF` |
| Neutral | `#D4D4D8` | `#27272A` | `#3F3F46` |

Also added for dark: `--primary-hover` `#A5B4FC`; accent text (active nav label) `#3730A3` light / `#C7D2FE` dark.

All text/background pairs must meet WCAG AA (4.5:1). Never signal status by colour alone — badges always carry a text label.

### 2.4 Status vocabulary

Use exactly these labels and mappings. Define once in `components/ui/status-badge.tsx`.

| Domain | Status | Style |
|---|---|---|
| Invoice | Paid | Success |
| | Partially Paid | Warning |
| | Unpaid | Neutral |
| | Overdue | Danger |
| | Void / Returned | Neutral, struck-through number |
| Installment row | Paid | Success |
| | Due soon (≤3 days) | Warning |
| | Pending | Neutral |
| | Overdue | Danger |
| | Waived | Neutral, italic |
| Serialized unit | In Stock | Success |
| | In Transit | Info |
| | Sold | Neutral |
| | Returned / Traded In | Warning |
| | Defective | Danger |
| Transfer | Draft | Neutral |
| | In Transit | Info |
| | Received | Success |
| | Cancelled | Neutral |
| Purchase order | Paid / Partially Paid / Unpaid / Overdue | Same as invoice |
| Notification | Queued | Neutral |
| | Sent | Info |
| | Delivered | Success |
| | Failed | Danger |
| Condition | Brand New, Open Box, UK Used, US Used, Refurbished | Outline badge, no fill |

### 2.5 Typography

- **UI font:** Inter (variable), fallback `system-ui, sans-serif`.
- **Mono:** JetBrains Mono, fallback `ui-monospace`. Used for IMEI, serial, SKU, invoice and transfer numbers, warranty IDs.
- **Numerals:** `font-variant-numeric: tabular-nums` on every money value, quantity, date and table number column. Right-align numeric columns.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| Display | 30 / 36 | 600 | KPI figures |
| H1 | 24 / 32 | 600 | Page title |
| H2 | 18 / 28 | 600 | Section title |
| H3 | 15 / 24 | 600 | Card title |
| Body | 14 / 20 | 400 | Default |
| Small | 13 / 18 | 400 | Table cells, meta |
| Caption | 12 / 16 | 500 | Labels, uppercase with 0.04em tracking |
| POS total | 36 / 40 | 700 | Cart total on the POS screen |

Letter-spacing −0.01em on H1 and Display. Sentence case for all headings, buttons and labels. No all-caps except the Caption style.

### 2.6 Money formatting

- Format `₦1,250,000.00` with thousands separators; always two decimals in ledgers and documents; KPI cards may abbreviate (`₦12.4M`) with the full value in a tooltip.
- Negative amounts and refunds: leading minus, Danger text colour. No parentheses.
- Outstanding balances: Foreground when current, Danger when overdue.
- Currency symbol comes from `config/store.ts`; never hard-code `₦` in components.

### 2.7 Spacing, radius, elevation

- **Spacing scale (px):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Page padding 24 (desktop), 16 (tablet). Card padding 20. Gap between cards 16.
- **Radius:** 6 inputs and buttons, 8 cards and popovers, 12 dialogs and sheets, full for badges and avatars.
- **Borders over shadows.** Cards are a 1px border with no shadow. Shadows only on floating layers: popover `0 4px 12px rgba(0,0,0,.08)`, dialog `0 16px 40px rgba(0,0,0,.16)`.
- **Focus:** 2px `--primary` ring with 2px offset on every interactive element. Never remove it.
- **Motion:** 150ms ease-out for hover, popover and sheet transitions. No decorative animation. Respect `prefers-reduced-motion`.

## 3. Layout shell

```
┌──────────┬──────────────────────────────────────────────┐
│ Sidebar  │ Top bar: [Branch switcher]  [⌘K search]  [🔔] [User] │
│ 240px    ├──────────────────────────────────────────────┤
│          │ Page header: Title · description · actions    │
│ nav      │ Content (max-width 1440, fluid)               │
└──────────┴──────────────────────────────────────────────┘
```

- **Sidebar:** 240px, `--surface`, collapsible to a 64px icon rail (default collapsed below 1280px). Groups: *Sell* (POS, Invoices, Customers) · *Stock* (Inventory, Intake, Transfers) · *Money* (Receivables, Payables, Suppliers, Aging) · *Admin* (Notifications, Audit, Settings). Items the role cannot use are not rendered.
- **Top bar:** 56px, sticky, bottom border.
- **Branch switcher** (top-left of the top bar): a combobox showing a coloured dot, branch name and code. Owners see "All branches" at the top with a globe icon, then each branch. Managers and cashiers see a static, non-interactive chip with their branch and a lock icon. When "All branches" is active, show a thin Info-tinted strip under the top bar: "Viewing consolidated data across all branches".
- **Command palette (⌘K / Ctrl-K):** jump to an invoice number, customer phone, IMEI or page.
- **Notifications bell:** low-stock, aging, overdue and failed-message alerts with counts.

**Breakpoints:** `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. Target devices are tablet landscape and up. Below 768px, show the app in a single column with tables collapsing to stacked cards; full phone optimisation is not a v1 goal.

## 4. Components

Use shadcn/ui primitives. House rules on top:

- **Buttons:** heights 32 (dense tables), 36 (default), 48 (POS/touch). Variants: primary (filled), secondary (outline), ghost, destructive. One primary per view. Destructive actions always confirm in a dialog that states the consequence.
- **Inputs:** 36px high (48px on POS), label above, helper or error text below. Money inputs show the currency symbol as a prefix and right-align the value. Phone inputs show the country code prefix and format as the user types.
- **Tables:** 44px rows (36px in compact mode), sticky header on `--surface`, hairline row dividers, no zebra striping, hover tint. Numeric columns right-aligned with tabular numerals. Row actions in a trailing kebab menu. Toolbar above with search, filter chips and column visibility. Pagination below with row count.
- **KPI card:** Caption label, Display figure, delta vs previous period with arrow and Success/Danger colour, optional 30-day sparkline. Restricted metrics are not rendered for roles without access — do not show a blurred or locked placeholder.
- **Status badge:** 22px high, 12px text, weight 500, tinted background with border, optional 6px leading dot.
- **Identifier chip:** mono text on `--surface`, with a copy button on hover. Used for IMEI, serial, invoice numbers.
- **Detail sheet:** right-side sheet (480px) for quick view of a unit, customer or invoice from any table without leaving the page.
- **Stepper:** horizontal, for transfer status (Draft → In Transit → Received) and wizard-style forms.
- **Timeline:** vertical, for payment history, notification log and audit trail. Each entry: icon, title, meta line (who · where · when), optional body.
- **Alert banner:** full-width, semantic tint, icon, message, one action. Used for overdue accounts, in-transit locks and provider failures.
- **Toast:** bottom-right, for confirmations ("Payment recorded · Confirmation queued to WhatsApp"). Errors that need action use a banner or dialog, not a toast.
- **Empty state:** icon, one-line explanation, one primary action. No illustrations.
- **Loading:** skeletons shaped like the content. No full-page spinners.

## 5. Screens

### 5.1 Executive dashboard

- Header: title, date-range picker (Today, 7d, 30d, This month, Custom), branch context from the switcher.
- **Row 1 — KPI cards (6):** Total Invoiced Sales · Cash Collected · Net Profit · Customer Receivables · Supplier Payables · Inventory Valuation. Invoiced and Collected sit side by side with a small "collection rate %" under Collected so the gap is obvious.
- **Row 2:** left (2/3) — "Invoiced vs collected" grouped bar or dual line chart over the period; right (1/3) — receivables aging as a horizontal stacked bar with bucket legend.
- **Row 3:** "Branch performance" table — one row per branch: invoiced, collected, receivables, units sold, stock value, low-stock count. Visible in All-branches view; in single-branch view replace with "Top products".
- **Row 4:** two lists side by side — "Installments due this week" and "Alerts" (low stock, aging 60+ days, overdue supplier bills, failed messages).

Charts: two series maximum per chart, `--primary` for the main series and Neutral for the comparison, direct labels where possible, gridlines in `--border`, no 3D, no pie charts with more than four slices.

### 5.2 POS / invoice builder

Two-column layout, full height, no page scroll.

- **Left (60%) — find and add.** Large auto-focused search field ("Scan IMEI or barcode, or search products"). Results as a list: product name, spec line, condition badge, IMEI chip, price, branch availability. Items at another branch are greyed with "At Lekki · 2" and cannot be added. Below the search when idle: category chips and a quick-pick accessory grid.
- **Right (40%) — cart and pay.** Customer selector at top. Line items: name, IMEI chip or quantity stepper, unit price, line discount, remove. Then subtotal, discount, trade-in, VAT, and **Total** in the POS total style. Payment type toggle: **Full payment | Installment**.
  - *Full:* payment method rows (method, amount, reference) with "Add split"; shows remaining to allocate, which must reach zero.
  - *Installment:* down payment, number of installments, frequency segmented control, first due date. A live schedule preview table sits underneath (#, due date, amount) with financed amount and per-installment amount called out. Guarantor and ID notes in a collapsible section. If approval is needed, the primary button reads "Request manager approval".
- Sticky footer: **Complete sale** (48px, primary, full width). Disabled with a reason line until valid.
- **Success state:** replaces the cart with invoice number, amount paid, balance, message status chips ("Receipt · WhatsApp · Queued"), and buttons: Print receipt, Download invoice, View warranty card, New sale.

All touch targets on this screen are at least 44×44px. The screen must be fully operable with a scanner and keyboard: Enter adds the top result, F2 focuses search, F4 focuses customer, F9 completes the sale.

### 5.3 Invoice detail

Header: invoice number chip, status badge, branch, date, cashier; actions (Print, Download PDF, Send reminder, Record payment, More → Return, Void). Body: left column items and totals; right column a **Balance card** (total, paid, balance, next due date) and tabs for Payment schedule, Payments, Messages, Activity.

### 5.4 Receivables ledger

- Summary strip: total outstanding, due this week, overdue amount, number of overdue accounts.
- Filter chips: All · Due soon · Overdue · Completed; branch and date filters.
- Table: customer, phone, invoice, selling branch, total, paid, balance, next due, days overdue, status. Overdue rows get a 2px Danger left border.
- **Record payment** opens a sheet: invoice summary, amount (defaults to next installment due, with "Pay full balance" shortcut), method, reference. A live "After this payment" line shows the new balance and which schedule rows will be settled. On save: toast plus the confirmation message status.

### 5.5 Payables ledger (Owner)

Mirror of receivables for suppliers: summary strip (total owed, due this week, overdue), table of purchase orders (supplier, PO number, branch, terms, total, paid, balance, due date, status), and a **Record payout** sheet tied to a specific PO.

### 5.6 Aging reports

Tabs: Receivables | Payables. Bucket summary cards (Not yet due, 1–7, 8–14, 15–30, 30+) that act as filters, then the detail table. Export to CSV.

### 5.7 Inventory

Tabs: Serialized units | Accessories | Products.

- *Serialized:* table with product, IMEI/serial chip, condition, colour, storage/RAM, battery %, branch, days in stock (Warning at 45+, Danger at 60+), selling price, status. Cost column only for Owner.
- *Accessories:* product, SKU, a quantity column per branch with low-stock cells tinted Warning, total, reorder level.
- Row click opens the detail sheet with the unit's full history as a timeline (received → transferred → sold → returned).

### 5.8 Stock intake

Single-page form in three sections: **Supplier and destination** (supplier, branch, reference, date) → **Items** → **Payment**.

- Items: add product, then for serialized products a bulk entry area — a textarea that accepts scanned or pasted IMEIs one per line, parsed into a table where condition, colour, storage, RAM, battery health, cost and selling price can be set per row or applied to all. Invalid or duplicate IMEIs are flagged inline in Danger before save.
- Payment: segmented control Paid in full | Partial deposit | On credit, with terms (Net 7/15/30) and a computed due date. A summary card shows total cost, paid now and balance added to the supplier's payable.
- After save: confirmation with "Print barcode labels".

### 5.9 Transfers

- List with status filter and direction (Incoming / Outgoing) relative to the active branch.
- **New transfer:** From and To branch, then an item picker scoped to the source branch. Serialized items are picked by IMEI (scan or search); accessories by quantity with available stock shown.
- **Detail:** status stepper at top, manifest table, activity timeline. Context-aware primary action: "Mark as shipped" → "Receive stock". Receiving shows a checklist where each IMEI is scanned or ticked and accessory quantities confirmed; mismatches raise a Warning banner before completing. "Print waybill" is always available once shipped.
- While in transit, a persistent Info banner states: "These items are locked from sale until received."

### 5.10 Customer profile

Header: name, phone, opt-in indicators for WhatsApp and SMS, lifetime spend, outstanding balance. Tabs: Overview (active plans with progress bars) · Purchases · Warranties · Messages · Notes.

**Messages tab:** timeline of every outbound message with channel icon, template name, status badge, timestamp, body preview and **Resend**. Failed messages show the provider error.

### 5.11 Settings

Sections: Store profile · Branches · Users and roles · Tax and payments · Message templates · Messaging providers · Approval rules.

- *Message templates:* editor on the left with clickable variable chips; live preview on the right rendered as a phone chat bubble, with a character counter and SMS segment count.
- *Messaging providers:* API keys are masked after save (last 4 characters visible), with "Replace" and "Send test message" actions.

### 5.12 Audit log

Read-only table: timestamp, user, branch, action, entity, summary. Filters for user, branch, action type and date. Row expands to a before/after diff. No edit or delete controls anywhere on this screen.

## 6. Printable documents

Documents are always light theme, black on white, regardless of app theme. Brand accent is limited to one thin rule and the document title. All identifiers in mono; all figures in tabular numerals.

### 6.1 A4 invoice (PDF)

- Margins 18mm. Header: store logo/name left; "INVOICE", number, date and status right.
- Two columns: **Issued by** (branch name, address, phone) and **Billed to** (customer name, phone).
- Items table: description (with condition and spec line), IMEI/serial, qty, unit price, amount.
- Totals block right-aligned: subtotal, discount, trade-in, VAT, **total**, amount paid, **balance due**.
- Payments table (date, method, reference, amount).
- For installment sales, a **Payment schedule** table (#, due date, amount, status) and a balance summary box.
- Warranty terms and expiry per device; footer with return policy, payment instructions and "Page x of y".

### 6.2 Thermal receipt (80mm)

72mm printable width, single column, 11–12px, centred header with branch details, dashed dividers, left-label/right-value rows, IMEI on its own line under the item, totals in bold, balance and next due date for installment sales, QR to the hosted invoice at the bottom. No colour, no images other than the QR.

### 6.3 Digital warranty certificate

- **PDF (A5 landscape):** thin border frame, store name, "Warranty Certificate", device model and spec, IMEI/serial, condition, purchase branch, purchase date, **expiry date**, warranty ID in mono, QR code to `/w/[publicId]`, terms in small print.
- **Hosted page:** centred card on a neutral background. A large status banner — Success "Warranty active · expires 14 Mar 2027" or Neutral "Warranty expired" or Danger "Warranty void" — then device details with the IMEI masked to its last four digits. No customer name or phone. Mobile-first, since customers open it from WhatsApp.

### 6.4 Transfer waybill / manifest (A4)

Header with transfer number, date and status; From and To branch blocks; item table (#, product, IMEI/serial, condition, qty); totals (units, lines); three signature blocks — Dispatched by, Carried by, Received by — each with name, signature and date lines.

### 6.5 Barcode labels

Code 128, 50×25mm default label: product name (truncated to one line), SKU in mono, barcode, selling price. Laid out on an A4 sheet grid or per-label for thermal label printers. Cost price never appears on a label.

## 7. Content and tone

- UI copy is short and plain: "Record payment", "Mark as shipped", "Send reminder".
- Buttons are verbs. Confirmations state the consequence: "Void INV-IKJ-000123? The 2 devices on it will return to stock."
- Errors say what happened and what to do: "This IMEI was sold a moment ago at this branch. Remove it to continue."
- Customer-facing messages are polite and specific, never threatening, even at 14 days overdue. Always include the amount, the invoice number and how to pay.
- Dates: `14 Mar 2026` in UI and documents; relative ("in 3 days", "7 days overdue") alongside in ledgers.

## 8. Accessibility

- WCAG 2.1 AA contrast throughout.
- Full keyboard operation; visible focus; logical tab order; dialogs trap focus and close on Escape.
- Every input has a programmatic label; errors are announced and linked with `aria-describedby`.
- Status is never colour-only. Icons that carry meaning have accessible names.
- Tables use proper header cells; sortable headers expose sort state.
- Minimum 44×44px touch targets on POS and all sheets.

## 9. Do not

- Do not use gradients, glassmorphism, drop shadows on cards or decorative illustrations.
- Do not introduce new colours outside the tokens; extend the token table first.
- Do not show cost, margin or supplier data in any component a cashier can reach.
- Do not use modals for long forms — use a page or a side sheet.
- Do not centre-align numbers or mix proportional numerals into tables.
- Do not rely on hover for anything essential; the counter is a touch device.
