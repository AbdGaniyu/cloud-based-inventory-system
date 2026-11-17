import "server-only";

import { decode, type JWT } from "next-auth/jwt";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { Role } from "@/generated/prisma/enums";
import { useSecureCookies } from "@/server/auth/options";
import { type Action, can, type Ctx, type ResourceFor } from "@/server/auth/permissions";
import { ACTIVE_BRANCH_COOKIE, resolveActiveBranchId } from "@/server/branch-context";
import { db } from "@/server/db";
import { UnauthenticatedError } from "@/server/errors";

export type SessionContext = Ctx & {
  name: string;
  email: string;
  /** Home branch details for display; null for OWNER. */
  homeBranch: { id: string; name: string; code: string } | null;
};

/**
 * Data access layer entry point: the signed-in user's context for this request, or null.
 * The JWT only proves who signed in; role, branch and active status are re-read from the database
 * so deactivating or re-assigning a user takes effect on their next request.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const cookieStore = await cookies();
  const token = await readSessionToken(cookieStore.getAll());
  const userId = token?.userId;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      branchId: true,
      isActive: true,
      branch: { select: { id: true, name: true, code: true, isActive: true } },
    },
  });
  if (!user || !user.isActive) return null;
  if (user.branch && !user.branch.isActive) return null;

  let activeBranchIds: string[] = [];
  if (user.role === "OWNER") {
    const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true } });
    activeBranchIds = branches.map((b) => b.id);
  }
  const cookieValue = cookieStore.get(ACTIVE_BRANCH_COOKIE)?.value;

  return {
    userId: user.id,
    role: user.role,
    branchId: user.branchId,
    activeBranchId: resolveActiveBranchId(user, cookieValue, activeBranchIds),
    name: user.name,
    email: user.email,
    homeBranch: user.branch ? { id: user.branch.id, name: user.branch.name, code: user.branch.code } : null,
  };
});

const SESSION_COOKIE = `${useSecureCookies ? "__Secure-" : ""}next-auth.session-token`;

/**
 * Reads and decrypts the next-auth session JWT straight from the cookie (signature and expiry are
 * verified by decode). next-auth splits large tokens into "<name>.0", "<name>.1" … chunks.
 * Server Components use this instead of getServerSession, which runs the full request handler.
 */
async function readSessionToken(all: { name: string; value: string }[]): Promise<JWT | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const chunkIndex = (name: string) => (name === SESSION_COOKIE ? -1 : Number(name.slice(SESSION_COOKIE.length + 1)));
  const raw = all
    .filter((c) => c.name === SESSION_COOKIE || c.name.startsWith(`${SESSION_COOKIE}.`))
    .sort((a, b) => chunkIndex(a.name) - chunkIndex(b.name))
    .map((c) => c.value)
    .join("");
  if (!raw) return null;
  try {
    return await decode({ token: raw, secret });
  } catch {
    // Expired, tampered or signed with a rotated secret: treat as signed out.
    return null;
  }
}

/** For pages and layouts: redirects to /login when signed out. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For pages: redirects to the dashboard when the role cannot use the page. */
export async function requirePageAccess<A extends Action>(action: A, resource?: ResourceFor<A>): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!can(ctx, action, resource)) redirect("/dashboard");
  return ctx;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActionSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "OWNER":
      return "Owner";
    case "BRANCH_MANAGER":
      return "Branch manager";
    case "CASHIER":
      return "Cashier";
  }
}
