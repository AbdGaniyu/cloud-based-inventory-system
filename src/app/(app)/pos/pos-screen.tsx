"use client";

import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { choosePosBranch, type CompletedSale, completeSale, searchPosCatalog } from "@/app/(app)/pos/actions";
import { type CartAccessory, type CartLine, moneyOrZero, newKey, type PaymentRow, type PlanDraft, previewTotals } from "@/app/(app)/pos/cart";
import { CustomerPicker } from "@/app/(app)/pos/customer-picker";
import { ApprovalDialog, TradeInDialog } from "@/app/(app)/pos/dialogs";
import { InstallmentCalculator, PaymentRows } from "@/app/(app)/pos/payment-section";
import { CatalogList, QuickPicks, SearchField } from "@/app/(app)/pos/search-panel";
import { SuccessPanel } from "@/app/(app)/pos/success-panel";
import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STORE } from "@/config/store";
import { addMonths, type CalendarDate } from "@/lib/dates";
import { installmentApproval } from "@/lib/installments";
import { sum, ZERO } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type CheckoutFormValues, checkoutSchema, type TradeInInput } from "@/lib/validators/checkout";
import type { CustomerOption } from "@/server/services/customer.service";
import type { CheckoutSettings } from "@/server/services/invoice.service";
import type { PosAccessory, PosBranch, PosCatalog, PosUnit } from "@/server/services/pos.service";

const SEARCH_DEBOUNCE_MS = 200;

const freshPayments = (method: PaymentRow["method"]): PaymentRow[] => [{ key: newKey("pay"), method, amount: "", reference: "" }];
const freshPlan = (today: CalendarDate): PlanDraft => ({
  numberOfInstallments: 3,
  frequency: "MONTHLY",
  firstDueDate: addMonths(today, 1),
  guarantorName: "",
  guarantorPhone: "",
  idVerificationNotes: "",
});

export function PosScreen({
  branch,
  isOwner,
  storeChoices,
  categories,
  initialCatalog,
  quickPicks,
  settings,
  canSelfApprove,
  today,
  deviceModels,
}: {
  branch: PosBranch;
  isOwner: boolean;
  /** Owner in all-branches view: stores to sell from. Null when the rail decides. */
  storeChoices: PosBranch[] | null;
  categories: string[];
  initialCatalog: PosCatalog;
  quickPicks: PosAccessory[];
  settings: CheckoutSettings;
  canSelfApprove: boolean;
  today: CalendarDate;
  deviceModels: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // ─── Catalog ───────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [searching, startSearch] = useTransition();

  const runSearch = useCallback(
    (q: string, cat: string | null) =>
      new Promise<PosCatalog | null>((resolve) => {
        startSearch(async () => {
          const result = await searchPosCatalog({ branchId: branch.id, q: q || undefined, category: cat ?? undefined });
          if (result.ok) setCatalog(result.data);
          resolve(result.ok ? result.data : null);
        });
      }),
    [branch.id],
  );

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim(), category), query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, category, runSearch]);

  // ─── Cart ──────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [discount, setDiscount] = useState("");
  const [tradeIn, setTradeIn] = useState<TradeInInput | null>(null);
  const [tradeInOpen, setTradeInOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<"FULL" | "INSTALLMENT">("FULL");
  const [payments, setPayments] = useState<PaymentRow[]>(freshPayments("BANK_TRANSFER"));
  const [downPayments, setDownPayments] = useState<PaymentRow[]>(freshPayments("CASH"));
  const [plan, setPlan] = useState<PlanDraft>(freshPlan(today));
  const [result, setResult] = useState<CompletedSale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [submitting, startSubmit] = useTransition();

  const unitsInCart = useMemo(() => new Set(lines.flatMap((l) => (l.kind === "unit" ? [l.unitId] : []))), [lines]);
  const accessoryQty = useMemo(() => new Map(lines.flatMap((l) => (l.kind === "accessory" ? [[l.productId, l.quantity] as const] : []))), [lines]);

  function addUnit(unit: PosUnit) {
    if (unitsInCart.has(unit.id) || result) return;
    setLines((ls) => [
      ...ls,
      { kind: "unit", key: newKey("u"), unitId: unit.id, productId: unit.productId, name: unit.name, spec: unit.spec, identifier: unit.identifier, condition: unit.condition, price: unit.price, discount: "" },
    ]);
  }

  function addAccessory(acc: PosAccessory) {
    if (result) return;
    setLines((ls) => {
      const existing = ls.find((l): l is CartAccessory => l.kind === "accessory" && l.productId === acc.productId);
      if (existing) {
        return ls.map((l) => (l === existing ? { ...existing, quantity: Math.min(existing.available, existing.quantity + 1) } : l));
      }
      if (acc.available <= 0) return ls;
      return [...ls, { kind: "accessory", key: newKey("a"), productId: acc.productId, name: acc.name, sku: acc.sku, price: acc.price, quantity: 1, available: acc.available, discount: "" }];
    });
  }

  /** Enter in the search box: exact scan → add it; otherwise add the top sellable result (DESIGN.md §5.2). */
  async function onSearchEnter() {
    const q = query.trim();
    if (!q) return;
    const found = await runSearch(q, category);
    if (!found) return;
    const exactUnit = found.exact?.kind === "unit" ? found.units.find((u) => u.id === (found.exact as { id: string }).id) : undefined;
    const exactAccessory = found.exact?.kind === "accessory" ? found.accessories.find((a) => a.productId === (found.exact as { productId: string }).productId) : undefined;
    const top = exactUnit ?? exactAccessory ?? found.units.find((u) => !unitsInCart.has(u.id)) ?? found.accessories.find((a) => a.available > 0);
    if (!top) return;
    if (top.kind === "unit") addUnit(top);
    else addAccessory(top);
    setQuery("");
    searchRef.current?.focus();
  }

  // ─── Totals and payment ────────────────────────────────────────────────────
  const preview = previewTotals(lines, discount, settings.vatRatePercent, tradeIn);
  const total = preview.totals?.total ?? ZERO;
  const paidFull = sum(payments.map((p) => moneyOrZero(p.amount)));
  const remaining = total.minus(paidFull);
  const downTotal = sum(downPayments.map((p) => moneyOrZero(p.amount)));
  const financed = total.minus(downTotal);
  const approval = installmentApproval({
    total,
    downPayment: downTotal,
    threshold: settings.approvalThreshold,
    minDownPaymentPercent: settings.minDownPaymentPercent,
  });
  const needsApprover = paymentType === "INSTALLMENT" && approval.required && !canSelfApprove;

  const blocker = !lines.length
    ? "Add at least one item"
    : !customer
      ? "Select a customer (F4)"
      : preview.error
        ? preview.error
        : paymentType === "FULL"
          ? remaining.gt(0)
            ? "Allocate the remaining amount"
            : remaining.lt(0)
              ? "Payments are more than the total"
              : null
          : financed.lte(0)
            ? "The down payment covers the total — use Full payment"
            : plan.firstDueDate <= today
              ? "Choose a first due date after today"
              : null;

  function buildPayload(approver?: { email: string; password: string }): CheckoutFormValues {
    const clean = (rows: PaymentRow[]) =>
      rows.filter((r) => r.amount.trim()).map((r) => ({ method: r.method, amount: r.amount, reference: r.reference || undefined }));
    return {
      branchId: isOwner ? branch.id : undefined,
      customerId: customer?.id ?? "",
      lines: lines.map((l) =>
        l.kind === "unit"
          ? { kind: "unit", unitId: l.unitId, discount: l.discount || undefined }
          : { kind: "accessory", productId: l.productId, quantity: l.quantity, discount: l.discount || undefined },
      ),
      discount: discount || undefined,
      tradeIn: tradeIn ?? undefined,
      payment:
        paymentType === "FULL"
          ? { type: "FULL", payments: clean(payments) }
          : {
              type: "INSTALLMENT",
              downPayments: clean(downPayments),
              numberOfInstallments: plan.numberOfInstallments,
              frequency: plan.frequency,
              firstDueDate: plan.firstDueDate,
              guarantorName: plan.guarantorName,
              guarantorPhone: plan.guarantorPhone,
              idVerificationNotes: plan.idVerificationNotes,
              approver,
            },
    };
  }

  function submit(approver?: { email: string; password: string }) {
    setError(null);
    const payload = buildPayload(approver);
    const parsed = checkoutSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the sale details.");
      return;
    }
    startSubmit(async () => {
      const response = await completeSale(payload);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setApprovalOpen(false);
      setResult(response.data);
    });
  }

  function onComplete() {
    if (blocker || submitting) return;
    if (needsApprover) setApprovalOpen(true);
    else submit();
  }

  function newSale() {
    setLines([]);
    setCustomer(null);
    setDiscount("");
    setTradeIn(null);
    setPaymentType("FULL");
    setPayments(freshPayments("BANK_TRANSFER"));
    setDownPayments(freshPayments("CASH"));
    setPlan(freshPlan(today));
    setResult(null);
    setError(null);
    setQuery("");
    router.refresh();
    void runSearch("", category);
    searchRef.current?.focus();
  }

  // ─── Keyboard: F2 search, F4 customer, F9 complete (DESIGN.md §5.2) ──────
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "F4") {
        event.preventDefault();
        setCustomerOpen(true);
      } else if (event.key === "F9") {
        event.preventDefault();
        onCompleteRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateLine = (key: string, patch: Partial<CartLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as CartLine) : l)));

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]">
      {/* ── Find and add ── */}
      <section aria-labelledby="find-heading" className="flex min-h-0 flex-col">
        <div className="flex shrink-0 flex-col gap-4 px-6 pt-5 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="find-heading" className="text-[26px] leading-8 font-medium tracking-tight">
              Find and add
            </h2>
            {storeChoices ? (
              <label className="flex items-center gap-2 text-small text-muted-foreground">
                Selling from
                <Select
                  value={branch.id}
                  onValueChange={(id) =>
                    void choosePosBranch(id).then((r) => {
                      if (r.ok) router.refresh();
                      else setError(r.error);
                    })
                  }
                >
                  <SelectTrigger size="sm" aria-label="Store to sell from" className="min-w-36 bg-background text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {storeChoices.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} <span className="font-mono text-muted-foreground">· {s.code}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ) : (
              <p className="text-small text-muted-foreground">
                Selling from {branch.name}
                {isOwner ? " · pick a branch in the rail to change" : ""}
              </p>
            )}
          </div>
          <SearchField ref={searchRef} value={query} onChange={setQuery} onEnter={() => void onSearchEnter()} busy={searching} />
          <nav aria-label="Categories" className="flex flex-wrap gap-2">
            {[null, ...categories].map((cat) => (
              <button
                key={cat ?? "all"}
                type="button"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
                className={cn(
                  "h-11 rounded-xl px-5 text-body font-medium transition-colors duration-150",
                  category === cat ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-secondary-hover",
                )}
              >
                {cat ?? "All"}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-5">
          <CatalogList
            catalog={catalog}
            branchName={branch.name}
            inCart={unitsInCart}
            accessoryQtyInCart={accessoryQty}
            onAddUnit={addUnit}
            onAddAccessory={addAccessory}
            loading={searching}
          />
          <QuickPicks items={quickPicks} accessoryQtyInCart={accessoryQty} onAdd={addAccessory} />
        </div>
      </section>

      {/* ── Cart and pay ── */}
      <aside aria-label="Cart and payment" className="flex min-h-0 flex-col border-l border-border bg-surface">
        {result ? (
          <SuccessPanel result={result} onNewSale={newSale} />
        ) : (
          <>
            <div className="border-b border-border p-4">
              <CustomerPicker customer={customer} onChange={setCustomer} open={customerOpen} onOpenChange={setCustomerOpen} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {lines.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-14 text-center">
                  <ShoppingBag aria-hidden className="size-8 text-muted-foreground" />
                  <p className="mt-3 text-h3">Cart is empty</p>
                  <p className="text-body text-muted-foreground">Scan a device or tap an accessory to add it.</p>
                </div>
              ) : (
                <>
                  <ul aria-label="Cart" className="divide-y divide-border">
                    {lines.map((line) => (
                      <li key={line.key} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[16px] font-medium">{line.name}</p>
                          <Money value={moneyOrZero(line.price).times(line.kind === "unit" ? 1 : line.quantity).minus(moneyOrZero(line.discount))} className="text-[16px] font-semibold" />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          {line.kind === "unit" ? (
                            <IdentifierChip value={line.identifier} copyable={false} />
                          ) : (
                            <div className="flex items-center gap-1">
                              <Button type="button" size="icon-sm" variant="secondary" aria-label={`One less ${line.name}`} disabled={line.quantity <= 1} onClick={() => updateLine(line.key, { quantity: line.quantity - 1 })}>
                                <Minus aria-hidden />
                              </Button>
                              <span className="w-8 text-center tabular-nums" aria-label="Quantity">{line.quantity}</span>
                              <Button type="button" size="icon-sm" variant="secondary" aria-label={`One more ${line.name}`} disabled={line.quantity >= line.available} onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}>
                                <Plus aria-hidden />
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Money value={line.price} className="text-small text-muted-foreground" />
                          {line.kind === "accessory" && <span className="text-small text-muted-foreground">each</span>}
                          <label className="ml-auto flex items-center gap-2 text-small text-muted-foreground">
                            Discount
                            <span className="relative">
                              <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">{STORE.currencySymbol}</span>
                              <Input
                                value={line.discount}
                                onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                                inputMode="decimal"
                                placeholder="0"
                                aria-label={`Discount on ${line.name}`}
                                className="h-10 w-28 bg-background pl-6 text-right tabular-nums"
                              />
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                            aria-label={`Remove ${line.name}`}
                            className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <dl className="border-t border-border px-4 py-3 text-body">
                    <div className="flex justify-between py-1">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd><Money value={preview.totals?.subtotal ?? ZERO} /></dd>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <dt className="text-muted-foreground">Discount</dt>
                      <dd className="relative">
                        <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">{STORE.currencySymbol}</span>
                        <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Invoice discount" className="h-9 w-32 bg-background pl-6 text-right tabular-nums" />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <dt className="text-muted-foreground">
                        Trade-in{" "}
                        <button type="button" onClick={() => setTradeInOpen(true)} className="ml-1 font-medium text-foreground underline underline-offset-4">
                          {tradeIn ? "Edit" : "Add"}
                        </button>
                      </dt>
                      <dd><Money value={preview.totals?.tradeInCredit ?? ZERO} /></dd>
                    </div>
                    <div className="flex justify-between py-1">
                      <dt className="text-muted-foreground">VAT {Number(settings.vatRatePercent)}%</dt>
                      <dd><Money value={preview.totals?.taxAmount ?? ZERO} /></dd>
                    </div>
                    <div className="mt-2 flex items-end justify-between border-t border-border pt-3">
                      <dt className="text-[16px] font-medium">Total</dt>
                      <dd><Money value={total} className="text-pos-total" /></dd>
                    </div>
                    {preview.error && <p className="mt-1 text-right text-small text-danger">{preview.error}</p>}
                  </dl>

                  <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
                    <Segmented
                      label="Payment type"
                      size="lg"
                      value={paymentType}
                      onChange={setPaymentType}
                      options={[
                        { value: "FULL", label: "Full payment" },
                        { value: "INSTALLMENT", label: "Installment" },
                      ]}
                    />
                    {paymentType === "FULL" ? (
                      <PaymentRows rows={payments} onChange={setPayments} remaining={remaining} label="Payment" />
                    ) : (
                      <>
                        <p className="text-small font-medium">Down payment</p>
                        <PaymentRows rows={downPayments} onChange={setDownPayments} remaining={ZERO} label="Down payment" />
                        <InstallmentCalculator plan={plan} onChange={setPlan} financed={financed} today={today} approval={{ ...approval, canSelfApprove }} />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="border-t border-border p-4">
              {error && (
                <p role="alert" className="mb-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-small text-danger">
                  {error}
                </p>
              )}
              <Button size="lg" className="h-14 w-full rounded-xl text-[17px]" disabled={Boolean(blocker) || submitting} onClick={onComplete}>
                {submitting && <Loader2 aria-hidden className="animate-spin" />}
                {needsApprover ? "Request manager approval" : "Complete sale"}
              </Button>
              <p className="mt-2 text-center text-small text-muted-foreground" aria-live="polite">
                {blocker ?? "F9 to complete"}
              </p>
            </div>
          </>
        )}
      </aside>

      <TradeInDialog
        key={tradeInOpen ? "open" : "closed"}
        open={tradeInOpen}
        onOpenChange={setTradeInOpen}
        value={tradeIn}
        deviceModels={deviceModels}
        onSave={(value) => {
          setTradeIn(value);
          setTradeInOpen(false);
        }}
      />
      <ApprovalDialog open={approvalOpen} onOpenChange={setApprovalOpen} reasons={approval.reasons} onApprove={submit} pending={submitting} error={error} />
    </div>
  );
}
