import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "@/app/(auth)/login/login-form";
import { Skeleton } from "@/components/ui/skeleton";
import { STORE } from "@/config/store";
import { safeCallbackPath } from "@/lib/safe-redirect";
import { getSessionContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-md bg-primary text-body font-bold text-primary-foreground"
          >
            {STORE.name.slice(0, 1)}
          </span>
          <span className="text-h2">{STORE.name}</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-h2">Sign in</h1>
          <p className="mt-1 mb-6 text-body text-muted-foreground">Use the email and password from your manager.</p>
          <Suspense fallback={<LoginFormSkeleton />}>
            <LoginGate searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { callbackUrl } = await searchParams;
  const destination = safeCallbackPath(callbackUrl);
  // Database-checked: a stale cookie for a deactivated user still sees the form.
  if (await getSessionContext()) redirect(destination);
  return <LoginForm callbackPath={destination} />;
}

function LoginFormSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
      <Skeleton className="h-9" />
    </div>
  );
}
