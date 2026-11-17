import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  FileText,
  HandCoins,
  LayoutDashboard,
  type LucideIcon,
  PackagePlus,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

import type { NavIconKey } from "@/components/shell/nav-config";

export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  invoices: FileText,
  customers: Users,
  inventory: Boxes,
  intake: PackagePlus,
  transfers: ArrowLeftRight,
  receivables: HandCoins,
  payables: Wallet,
  suppliers: Truck,
  aging: BarChart3,
  notifications: Bell,
  audit: ScrollText,
  settings: Settings,
};
