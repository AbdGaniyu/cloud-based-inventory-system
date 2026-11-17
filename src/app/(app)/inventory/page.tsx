import { PackagePlus, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { AccessoriesTable } from "@/app/(app)/inventory/accessories-table";
import { ProductSheet } from "@/app/(app)/inventory/product-sheet";
import { ProductsTable } from "@/app/(app)/inventory/products-table";
import { UnitSheet } from "@/app/(app)/inventory/unit-sheet";
import { UnitsTable } from "@/app/(app)/inventory/units-table";
import { FilterChips } from "@/components/filter-chips";
import { formatMoneyShort } from "@/components/money";
import { Pagination } from "@/components/pagination";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand, type SummaryItem } from "@/components/summary-band";
import { Button } from "@/components/ui/button";
import { STORE } from "@/config/store";
import { TrackingType, UnitCondition, UnitStatus } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { canSeeCost } from "@/server/auth/field-access";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import {
  getStockSummary,
  getUnitDetail,
  listAccessoryStock,
  listProducts,
  listSerializedProductOptions,
  listSerializedUnits,
  type UnitDetail,
} from "@/server/services/inventory.service";
import { getProductForEdit } from "@/server/services/product.service";

export const metadata: Metadata = { title: "Inventory" };

const flag = z.literal("1").optional().catch(undefined);
const paramsSchema = z.object({
  tab: z.enum(["units", "accessories", "products"]).catch("units"),
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.union([z.enum(UnitStatus), z.literal("ALL")]).optional().catch(undefined),
  condition: z.enum(UnitCondition).optional().catch(undefined),
  product: z.guid().optional().catch(undefined),
  aging: flag,
  low: flag,
  category: z.string().trim().max(40).optional().catch(undefined),
  type: z.enum(TrackingType).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
  unit: z.guid().optional().catch(undefined),
  edit: z.union([z.literal("new"), z.guid()]).optional().catch(undefined),
});

type Params = z.infer<typeof paramsSchema>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/inventory">["searchParams"] }) {
  const ctx = await requirePageAccess("inventory.view");
  const raw = await searchParams;
  const params: Params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)])));
  const summary = await getStockSummary(ctx);
  const showCost = canSeeCost(ctx);
  const canEditProducts = can(ctx, "price.edit");
  const keep = (extra: Record<string, string | undefined>) => ({ tab: params.tab === "units" ? undefined : params.tab, ...extra });

  const summaryItems: SummaryItem[] = [
    {
      label: "Devices in stock",
      value: summary.devicesInStock.toLocaleString(),
      sub: summary.devicesInTransit ? `${summary.devicesInTransit} in transit` : "Serialized units",
      href: "/inventory",
    },
    { label: "Accessories on hand", value: summary.accessoriesOnHand.toLocaleString(), sub: "Units across lines", href: "/inventory?tab=accessories" },
    {
      label: "Low stock",
      value: summary.lowStockLines.toLocaleString(),
      tone: summary.lowStockLines > 0 ? "warning" : undefined,
      sub: "Lines at or below reorder level",
      href: "/inventory?tab=accessories&low=1",
    },
    {
      label: `In stock ${summary.agingDays}+ days`,
      value: summary.agingUnits.toLocaleString(),
      tone: summary.agingUnits > 0 ? "warning" : undefined,
      sub: "Devices aging on the shelf",
      href: "/inventory?aging=1",
    },
    ...(summary.valuation
      ? [
          {
            label: "Inventory value",
            value: formatMoneyShort(summary.valuation.amount, STORE.currencySymbol),
            title: formatMoney(summary.valuation.amount),
            sub: summary.valuation.basis === "cost" ? "At cost" : "At selling price",
          },
        ]
      : []),
  ];

  const tabs = [
    { label: "Devices", href: "/inventory", active: params.tab === "units", count: summary.devicesInStock },
    { label: "Accessories", href: "/inventory?tab=accessories", active: params.tab === "accessories" },
    { label: "Products", href: "/inventory?tab=products", active: params.tab === "products" },
  ];

  const tabBody =
    params.tab === "units"
      ? await renderUnits(showCost, ctx.role === "OWNER" && ctx.activeBranchId === null)
      : params.tab === "accessories"
        ? await renderAccessories()
        : await renderProducts(showCost, canEditProducts);

  let unitDetail: UnitDetail | null = null;
  let unitError: string | null = null;
  if (params.unit) {
    try {
      unitDetail = await getUnitDetail(ctx, params.unit);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      unitError = error.message;
    }
  }

  return (
    <>
      <SummaryBand
        title="Stock summary"
        items={summaryItems}
        actions={
          can(ctx, "intake.create") ? (
            <Button asChild variant="secondary">
              <Link href="/inventory/intake">
                <PackagePlus aria-hidden data-icon="inline-start" /> Receive stock
              </Link>
            </Button>
          ) : null
        }
      />
      <PageBody>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <FilterChips label="Inventory views" items={tabs} />
          {params.tab === "products" && canEditProducts && (
            <Button asChild>
              <Link href={`/inventory?tab=products&edit=new`} scroll={false}>
                <Plus aria-hidden data-icon="inline-start" /> New product
              </Link>
            </Button>
          )}
        </div>
        {tabBody}
      </PageBody>
      <UnitSheet detail={unitDetail} error={unitError} />
    </>
  );

  async function loadProductForEdit(id: string) {
    try {
      return await getProductForEdit(ctx, id);
    } catch (error) {
      // A stale ?edit= link to a deleted product just opens the "new product" form.
      if (error instanceof AppError) return null;
      throw error;
    }
  }

  async function renderUnits(showCost: boolean, showBranch: boolean) {
    const ctxParams = params;
    const [list, products] = await Promise.all([
      listSerializedUnits(ctx, {
        q: ctxParams.q,
        status: ctxParams.status,
        condition: ctxParams.condition,
        productId: ctxParams.product,
        aging: ctxParams.aging === "1",
        page: ctxParams.page,
      }),
      listSerializedProductOptions(ctx),
    ]);
    return (
      <>
        <UnitsTable
          rows={list.rows}
          agingDays={list.agingDays}
          showCost={showCost}
          showBranch={showBranch}
          products={products}
          agingActive={ctxParams.aging === "1"}
        />
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          noun="devices"
          params={keep({ q: ctxParams.q, status: ctxParams.status, condition: ctxParams.condition, product: ctxParams.product, aging: ctxParams.aging })}
        />
      </>
    );
  }

  async function renderAccessories() {
    const p = params;
    const list = await listAccessoryStock(ctx, { q: p.q, lowOnly: p.low === "1", page: p.page });
    return (
      <>
        <AccessoriesTable rows={list.rows} branches={list.branches} scopeBranchId={list.scopeBranchId} lowOnly={p.low === "1"} />
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="accessories" params={keep({ q: p.q, low: p.low })} />
      </>
    );
  }

  async function renderProducts(showCost: boolean, canEdit: boolean) {
    const p = params;
    const [list, editing] = await Promise.all([
      listProducts(ctx, { q: p.q, category: p.category, trackingType: p.type, page: p.page }),
      canEdit && p.edit && p.edit !== "new" ? loadProductForEdit(p.edit) : Promise.resolve(null),
    ]);
    return (
      <>
        <ProductsTable rows={list.rows} categories={list.categories} canEdit={canEdit} showCost={showCost} />
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="products" params={keep({ q: p.q, category: p.category, type: p.type })} />
        {canEdit && <ProductSheet open={Boolean(p.edit)} product={editing} categories={list.categories} />}
      </>
    );
  }
}
