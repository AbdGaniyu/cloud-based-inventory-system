import { type Action, can, type Ctx } from "@/server/auth/permissions";

/** Icon keys are resolved to lucide components on the client (components can't cross the RSC boundary). */
export type NavIconKey =
  | "dashboard"
  | "pos"
  | "invoices"
  | "customers"
  | "inventory"
  | "intake"
  | "transfers"
  | "receivables"
  | "payables"
  | "suppliers"
  | "aging"
  | "notifications"
  | "audit"
  | "settings";

export type NavItem = { href: string; label: string; icon: NavIconKey };
export type NavGroup = { label: string | null; items: NavItem[] };

type NavItemDef = NavItem & { action: Action };

/** DESIGN.md §3: Sell · Stock · Money · Admin. */
const NAV: { label: string | null; items: NavItemDef[] }[] = [
  { label: null, items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", action: "dashboard.view" }] },
  {
    label: "Sell",
    items: [
      { href: "/pos", label: "POS", icon: "pos", action: "invoice.create" },
      { href: "/invoices", label: "Invoices", icon: "invoices", action: "invoice.view" },
      { href: "/customers", label: "Customers", icon: "customers", action: "customer.view" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/inventory", label: "Inventory", icon: "inventory", action: "inventory.view" },
      { href: "/inventory/intake", label: "Intake", icon: "intake", action: "intake.create" },
      { href: "/transfers", label: "Transfers", icon: "transfers", action: "transfer.view" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/ledger/receivables", label: "Receivables", icon: "receivables", action: "payment.record" },
      { href: "/ledger/payables", label: "Payables", icon: "payables", action: "payables.view" },
      { href: "/suppliers", label: "Suppliers", icon: "suppliers", action: "payables.view" },
      { href: "/reports/aging", label: "Aging", icon: "aging", action: "report.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/notifications", label: "Notifications", icon: "notifications", action: "notification.view" },
      { href: "/audit", label: "Audit log", icon: "audit", action: "audit.view" },
      { href: "/settings", label: "Settings", icon: "settings", action: "settings.view" },
    ],
  },
];

/** Navigation the user can use. Items the role cannot use are not rendered at all (DESIGN.md §3). */
export function visibleNav(ctx: Ctx): NavGroup[] {
  return NAV.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => can(ctx, item.action)).map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((group) => group.items.length > 0);
}
