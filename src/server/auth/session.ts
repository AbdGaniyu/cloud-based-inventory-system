import "server-only";

import { decode, encode, type JWT } from "next-auth/jwt";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { Role } from "@/generated/prisma/enums";
import { SESSION_MAX_AGE_SECONDS, useSecureCookies } from "@/server/auth/options";
import { type Action, can, type Ctx, type ResourceFor } from "@/server/auth/permissions";
import { ACTIVE_BRANCH_COOKIE, resolveActiveBranchId } from "@/server/branch-context";
import { db } from "@/server/db";
import { ForbiddenError, UnauthenticatedError } from "@/server/errors";
import { type PendingStep, pendingStep } from "@/server/services/account.service";

export type SessionContext = Ctx & {
  name: string;
  email: string;
  /** Home branch details for display; null for OWNER. */
  homeBranch: { id: string; name: string; code: string } | null;
};

/** A valid session plus what (if anything) the person must do before using the app (see account.service). */
export type SessionState = { ctx: SessionContext; pending: PendingStep };

/**
 * The signed-in user's session for this request, or null. The JWT only proves who signed in; role,
 * branch, active status and session version are re-read from the database, so deactivating,
 * re-assigning or signing a user out everywhere takes effect on their next request.
 */
export const getSessionState = cache(async (): Promise<SessionState | null> => {
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
      sessionVersion: true,
      mustChangePassword: true,
      totpEnabledAt: true,
      branch: { select: { id: true, name: true, code: true, isActive: true } },
    },
  });
  if (!user || !user.isActive) return null;
  if (user.branch && !user.branch.isActive) return null;
  // Signed out everywhere since this token was issued (password reset, 2FA change, "sign out other devices"…).
  if ((token.sv ?? 0) !== user.sessionVersion) return null;

  let activeBranchIds: string[] = [];
  if (user.role === "OWNER") {
    const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true } });
    activeBranchIds = branches.map((b) => b.id);
  }
  const cookieValue = cookieStore.get(ACTIVE_BRANCH_COOKIE)?.value;

  const ctx: SessionContext = {
    userId: user.id,
    role: user.role,
    branchId: user.branchId,
    activeBranchId: resolveActiveBranchId(user, cookieValue, activeBranchIds),
    name: user.name,
    email: user.email,
    homeBranch: user.branch ? { id: user.branch.id, name: user.branch.name, code: user.branch.code } : null,
  };
  return { ctx, pending: pendingStep(user) };
});

/**
 * Data access layer entry point: the signed-in user's context, or null. Someone who still has to
 * change a temporary password or set up required two-factor counts as signed out here; only the
 * account page (requireAccountSession) serves them.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const state = await getSessionState();
  return state && !state.pending ? state.ctx : null;
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

/** For pages and layouts: redirects to /login when signed out, and to /account while a security step is pending. */
export async function requireSession(): Promise<SessionContext> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (state.pending) redirect("/account");
  return state.ctx;
}

/** For the account page: any valid session, including one with a pending step. */
export async function requireAccountSession(): Promise<SessionState> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  return state;
}

/** For pages: redirects to the dashboard when the role cannot use the page. */
export async function requirePageAccess<A extends Action>(action: A, resource?: ResourceFor<A>): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!can(ctx, action, resource)) redirect("/dashboard");
  return ctx;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireActionSession(): Promise<SessionContext> {
  const state = await getSessionState();
  if (!state) throw new UnauthenticatedError();
  if (state.pending) throw new ForbiddenError("Finish securing your account first (Account security).");
  return state.ctx;
}

/** For the account page's own actions. */
export async function requireAccountActionSession(): Promise<SessionState> {
  const state = await getSessionState();
  if (!state) throw new UnauthenticatedError();
  return state;
}

/**
 * After a change that bumped User.sessionVersion, re-issues this device's session cookie with the
 * new version so only the other devices are signed out. Keeps the original expiry.
 */
export async function reissueSessionCookie(sessionVersion: number): Promise<void> {
  const cookieStore = await cookies();
  const token = await readSessionToken(cookieStore.getAll());
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) throw new UnauthenticatedError();
  const remaining = typeof token.exp === "number" ? token.exp - Math.floor(Date.now() / 1000) : SESSION_MAX_AGE_SECONDS;
  if (remaining <= 0) throw new UnauthenticatedError();
  // encode() sets fresh iat/exp/jti from maxAge.
  const claims: JWT = { ...token, sv: sessionVersion };
  for (const k of ["exp", "iat", "jti"] as const) delete claims[k];
  const value = await encode({ token: claims, secret, maxAge: remaining });
  for (const c of cookieStore.getAll()) if (c.name.startsWith(`${SESSION_COOKIE}.`)) cookieStore.delete(c.name);
  cookieStore.set(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies, maxAge: remaining });
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
