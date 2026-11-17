import {
  Bell,
  Factory,
  HandCoins,
  Hourglass,
  LayoutGrid,
  type LucideIcon,
  Package,
  PackagePlus,
  ReceiptText,
  ScanBarcode,
  ScrollText,
  Settings,
  Truck,
  Users,
  Wallet,
  Calculator,
} from "lucide-react";

import type { NavIconKey } from "@/components/shell/nav-config";

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutGrid,
  pos: ScanBarcode,
  invoices: ReceiptText,
  customers: Users,
  inventory: Package,
  intake: PackagePlus,
  transfers: Truck,
  receivables: HandCoins,
  payables: Wallet,
  suppliers: Factory,
  aging: Hourglass,
  notifications: Bell,
  audit: ScrollText,
  settings: Settings,
  cashup: Calculator,
};
