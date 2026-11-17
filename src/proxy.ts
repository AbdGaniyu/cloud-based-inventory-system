import { getToken } from "next-auth/jwt";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic auth redirect: reads the session cookie only (no database). The real checks happen
 * in the data access layer (src/server/auth/session.ts) and in every service via can().
 * Signed-in users are not bounced away from /login here, because a cookie may belong to a user who
 * has since been deactivated; the login page decides that with a database check.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    // Must match authOptions.useSecureCookies (proxy must not import app modules).
    secureCookie: (process.env.APP_URL ?? "").startsWith("https://"),
  });
  if (token) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except: auth, cron, webhook and PDF APIs (each checks its own access — PDFs accept signed links),
    // public warranty pages, Next internals, static files.
    "/((?!api/auth|api/cron|api/webhooks|api/pdf|w/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
