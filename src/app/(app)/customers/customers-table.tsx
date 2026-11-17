"use client";

import { MessageCircle, MessageSquareText, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { DataTable, columnHelper } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { SearchInput } from "@/components/search-input";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { CustomerListRow } from "@/server/services/customer.service";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const col = columnHelper<CustomerListRow>();

function OptIns({ whatsapp, sms }: { whatsapp: boolean; sms: boolean }) {
  return (
    <span className="flex items-center gap-2 text-small">
      <span className={cn("flex items-center gap-1", whatsapp ? "text-foreground" : "text-subtle-foreground line-through")} title={whatsapp ? "WhatsApp on" : "WhatsApp off"}>
        <MessageCircle aria-hidden className="size-3.5" /> <span className="sr-only">WhatsApp {whatsapp ? "on" : "off"}</span>
      </span>
      <span className={cn("flex items-center gap-1", sms ? "text-foreground" : "text-subtle-foreground line-through")} title={sms ? "SMS on" : "SMS off"}>
        <MessageSquareText aria-hidden className="size-3.5" /> <span className="sr-only">SMS {sms ? "on" : "off"}</span>
      </span>
    </span>
  );
}

export function CustomersTable({ rows }: { rows: CustomerListRow[] }) {
  const router = useRouter();
  const columns = col.columns([
    col.accessor("name", {
      header: "Customer",
      enableHiding: false,
      cell: ({ row }) => (
        <div>
          <p className="text-body font-medium">{row.original.name}</p>
          <p className="text-small text-muted-foreground tabular-nums">{formatPhoneDisplay(row.original.phoneE164)}</p>
        </div>
      ),
    }),
    col.display({ id: "messages", header: "Messages", meta: { label: "Messages" }, cell: ({ row }) => <OptIns whatsapp={row.original.whatsappOptIn} sms={row.original.smsOptIn} /> }),
    col.accessor("invoiceCount", { header: "Invoices", meta: { label: "Invoices", align: "right" }, cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> }),
    col.accessor("outstanding", {
      header: "Outstanding",
      meta: { label: "Outstanding", align: "right" },
      cell: ({ getValue }) => <Money value={getValue()} className={getValue() === "0.00" ? "text-muted-foreground" : "font-medium"} />,
    }),
    col.accessor("lastPurchaseAt", { header: "Last purchase", meta: { label: "Last purchase" }, cell: ({ getValue }) => { const v = getValue(); return v ? dateFormat.format(new Date(v)) : "—"; } }),
  ]);
  return (
    <DataTable
      caption="Customers"
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      onRowOpen={(row) => router.push(`/customers/${row.id}`)}
      rowLabel={(row) => `${row.name} — open`}
      toolbar={<SearchInput placeholder="Name or phone number" label="Search customers" />}
      empty={<EmptyState icon={UsersRound} title="No customers match" description="Customers are added at the POS." />}
    />
  );
}
