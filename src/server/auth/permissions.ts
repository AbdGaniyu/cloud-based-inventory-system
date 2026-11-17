import type { Role } from "@/generated/prisma/enums";
import { calendarDateInStoreTz } from "@/lib/dates";
import { ForbiddenError } from "@/server/errors";

/**
 * Single source of truth for the RBAC matrix (CLAUDE.md §8). Pure and dependency-free so services,
 * Server Components and Client Components all use the same function. Services must call it
 * (or assertCan) before doing anything; the UI uses it only to hide controls.
 */

/** Who is acting, and on which branch scope. Every service function takes this. */
export type Ctx = {
  userId: string;
  role: Role;
  /** Home branch. Null for OWNER. */
  branchId: string | null;
  /** Branch the user is looking at. Null = all branches (OWNER only). Always branchId for non-owners. */
  activeBranchId: string | null;
};

type BranchResource = { branchId: string };

/**
 * Actions and the resource each can be checked against. Calling can() without the resource asks
 * "can this role ever do this?" (used for navigation); passing it checks the specific record.
 */
type ActionResources = {
  "dashboard.view": never;
  "invoice.view": never;
  "invoice.create": never;
  "customer.view": never;
  "customer.create": never;
  "payment.record": never;
  "message.send": never;
  "notification.view": never;
  "inventory.view": never;
  "stock.viewSisterBranches": never;
  "installment.approve": BranchResource;
  "intake.create": BranchResource;
  "transfer.view": never;
  "transfer.create": { fromBranchId: string };
  "transfer.ship": { fromBranchId: string };
  "transfer.receive": { toBranchId: string };
  "transfer.cancel": { fromBranchId: string };
  "report.view": never;
  "cost.view": never;
  "payables.view": never;
  "supplier.payout": never;
  "price.edit": never;
  "stock.adjust": never;
  "invoice.void": BranchResource & { createdAt: Date };
  "debt.waive": never;
  "payment.reverse": never;
  /** Receiving a return (and refunding) at a branch. Late returns are owner-only (checked in the service). */
  "return.create": BranchResource;
  "reminders.manage": BranchResource;
  "user.manage": never;
  "branch.manage": never;
  "tax.manage": never;
  "messaging.manage": never;
  "branch.viewAll": never;
  "audit.view": { branchId: string | null };
  "settings.view": never;
  /** Cashing up your own drawer at your branch (everyone who takes money). */
  "cashup.submit": never;
  /** Seeing everyone's cash-ups and expected takings at a branch, and signing them off. */
  "cashup.review": BranchResource;
};

export type Action = keyof ActionResources;
export type ResourceFor<A extends Action> = ActionResources[A];

type Options = { now?: Date };

const ALL_STAFF: readonly Role[] = ["OWNER", "BRANCH_MANAGER", "CASHIER"];
const MANAGERS: readonly Role[] = ["OWNER", "BRANCH_MANAGER"];

/** Actions open to these roles with no branch condition. */
const ROLE_ONLY: Partial<Record<Action, readonly Role[]>> = {
  "dashboard.view": ALL_STAFF,
  "invoice.view": ALL_STAFF,
  "invoice.create": ALL_STAFF,
  "customer.view": ALL_STAFF,
  "customer.create": ALL_STAFF,
  "payment.record": ALL_STAFF,
  "message.send": ALL_STAFF,
  "notification.view": ALL_STAFF,
  "inventory.view": ALL_STAFF,
  "stock.viewSisterBranches": ALL_STAFF,
  "cashup.submit": ALL_STAFF,
  "transfer.view": MANAGERS,
  "report.view": MANAGERS,
};

function ownBranch(ctx: Ctx, branchId: string | undefined): boolean {
  // No resource: the manager can do it for their own branch.
  return branchId === undefined || (ctx.branchId !== null && ctx.branchId === branchId);
}

export function can<A extends Action>(ctx: Ctx, action: A, resource?: ResourceFor<A>, options: Options = {}): boolean {
  if (ctx.role === "OWNER") return true;

  const roleOnly = ROLE_ONLY[action];
  if (roleOnly) return roleOnly.includes(ctx.role);

  if (ctx.role !== "BRANCH_MANAGER") return false;

  // Branch managers: own-branch capabilities only. Everything not listed is owner-only.
  const r = resource as Partial<Record<string, unknown>> | undefined;
  switch (action) {
    case "installment.approve":
    case "cashup.review":
    case "intake.create":
    case "reminders.manage":
    case "return.create":
      return ownBranch(ctx, r?.branchId as string | undefined);
    case "transfer.create":
    case "transfer.ship":
    case "transfer.cancel":
      return ownBranch(ctx, r?.fromBranchId as string | undefined);
    case "transfer.receive":
      return ownBranch(ctx, r?.toBranchId as string | undefined);
    case "audit.view": {
      if (!r) return true;
      return r.branchId !== null && ownBranch(ctx, r.branchId as string);
    }
    case "invoice.void": {
      if (!r) return true;
      const createdAt = r.createdAt as Date;
      const now = options.now ?? new Date();
      return (
        ownBranch(ctx, r.branchId as string) &&
        calendarDateInStoreTz(createdAt) === calendarDateInStoreTz(now)
      );
    }
    default:
      return false;
  }
}

/** Throwing variant for services. */
export function assertCan<A extends Action>(
  ctx: Ctx,
  action: A,
  resource?: ResourceFor<A>,
  options?: Options,
): void {
  if (!can(ctx, action, resource, options)) throw new ForbiddenError();
}

/** Throws unless the user has one of the given roles. Prefer can(); this is for role-shaped rules. */
export function requireRole(ctx: Ctx, ...roles: Role[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}
