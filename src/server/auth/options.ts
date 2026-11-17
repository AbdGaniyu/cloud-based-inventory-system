import "server-only";

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { loginSchema } from "@/lib/validators/auth";
import { clientIp } from "@/server/client-ip";
import { verifyCredentials } from "@/server/services/auth.service";

/** One working shift; staff sign in again after this. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

// next-auth v4 reads NEXTAUTH_URL for callback URLs; APP_URL is this app's single source of truth.
process.env.NEXTAUTH_URL ??= process.env.APP_URL;

/** Must match the proxy's getToken() call so both read the same cookie name. */
export const useSecureCookies = (process.env.APP_URL ?? "").startsWith("https://");

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  useSecureCookies,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        return verifyCredentials(parsed.data, clientIp(req.headers ?? {}));
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = user.role;
        token.branchId = user.branchId;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        id: token.userId,
        name: token.name ?? "",
        email: token.email ?? "",
        role: token.role,
        branchId: token.branchId,
      };
      return session;
    },
  },
};
