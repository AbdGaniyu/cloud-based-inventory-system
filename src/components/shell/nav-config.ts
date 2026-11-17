import { type Action, can, type Ctx } from "@/server/auth/permissions";

/** Icon keys are resolved to lucide components on the client (components can't cross the RSC boundary). */
export type NavIconKey =
  | "overview"
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
  | "settings"
  | "cashup";

/** Which shell count a nav item shows, and how (DESIGN.md §3). */
export type NavCountKey = "invoices" | "openTransfers" | "overdueAccounts" | "failedMessages";
export type NavCountTone = "neutral" | "info" | "attention";

export type NavItem = {
  href: string;
  label: string;
  /** Top-bar title when this page is open (defaults to label). */
  title?: string;
  icon: NavIconKey;
  count?: { key: NavCountKey; tone: NavCountTone };
};
export type NavGroup = { label: string | null; items: NavItem[] };

type NavItemDef = NavItem & { action: Action };

const NAV: { label: string | null; items: NavItemDef[] }[] = [
  { label: null, items: [{ href: "/dashboard", label: "Overview", icon: "overview", action: "dashboard.view" }] },
  {
    label: "Sell",
    items: [
      { href: "/pos", label: "POS", title: "New sale", icon: "pos", action: "invoice.create" },
      {
        href: "/invoices",
        label: "Invoices",
        icon: "invoices",
        action: "invoice.view",
        count: { key: "invoices", tone: "neutral" },
      },
      { href: "/customers", label: "Customers", icon: "customers", action: "customer.view" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/inventory", label: "Inventory", icon: "inventory", action: "inventory.view" },
      { href: "/inventory/intake", label: "Intake", title: "Stock intake", icon: "intake", action: "intake.create" },
      {
        href: "/transfers",
        label: "Transfers",
        icon: "transfers",
        action: "transfer.view",
        count: { key: "openTransfers", tone: "info" },
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        href: "/ledger/receivables",
        label: "Receivables",
        icon: "receivables",
        action: "payment.record",
        count: { key: "overdueAccounts", tone: "attention" },
      },
      { href: "/cash-up", label: "Cash-up", title: "Cash-up", icon: "cashup", action: "cashup.submit" },
      { href: "/ledger/payables", label: "Payables", icon: "payables", action: "payables.view" },
      { href: "/suppliers", label: "Suppliers", icon: "suppliers", action: "payables.view" },
      { href: "/reports/aging", label: "Aging", title: "Aging report", icon: "aging", action: "report.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/notifications",
        label: "Notifications",
        icon: "notifications",
        action: "notification.view",
        count: { key: "failedMessages", tone: "attention" },
      },
      { href: "/audit", label: "Audit", title: "Audit log", icon: "audit", action: "audit.view" },
      { href: "/settings", label: "Settings", icon: "settings", action: "settings.view" },
    ],
  },
];

/** Navigation the user can use. Items the role cannot use are not rendered at all (DESIGN.md §3). */
export function visibleNav(ctx: Ctx): NavGroup[] {
  return NAV.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => can(ctx, item.action))
      .map(({ href, label, title, icon, count }) => ({ href, label, title, icon, count })),
  })).filter((group) => group.items.length > 0);
}

/** The nav item a path belongs to: the longest href that is the path or a parent of it. */
export function matchNavItem(nav: NavGroup[], pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of nav.flatMap((g) => g.items)) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}
