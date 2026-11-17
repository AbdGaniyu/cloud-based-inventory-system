import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PasswordForm, SignOutLink, SignOutOthersButton, TwoFactorPanel } from "@/app/(account)/account/account-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/status-badge";
import { STORE } from "@/config/store";
import { requireAccountSession } from "@/server/auth/session";
import { getAccountSecurity } from "@/server/services/account.service";

export const metadata: Metadata = { title: "Account security" };

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/**
 * The person's own sign-in security. Outside the app shell on purpose: someone with a temporary
 * password or a required two-factor set-up lands here and can do nothing else until it is done.
 */
export default function AccountPage() {
  return (
    <main className="flex min-h-screen justify-center bg-surface px-4 py-10">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-primary text-body font-bold text-primary-foreground">
            {STORE.name.slice(0, 1)}
          </span>
          <span className="text-h2">{STORE.name}</span>
        </div>
        <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
          <Content />
        </Suspense>
      </div>
    </main>
  );
}

function Card({ title, description, children, aside }: { title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6" aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h3">{title}</h2>
          {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

async function Content() {
  const { ctx } = await requireAccountSession();
  const account = await getAccountSecurity(ctx);
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-h1">Account security</h1>
        <p className="text-body text-muted-foreground">
          {account.name} · {account.email}
        </p>
      </div>
      {account.pending ? (
        <SignOutLink />
      ) : (
        <Link href="/dashboard" className="flex items-center gap-1 text-small font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden className="size-4" /> Back to the app
        </Link>
      )}
    </div>
  );

  if (account.pending === "password") {
    return (
      <>
        {header}
        <Card title="Choose your own password" description="You signed in with a temporary password someone else set. Pick a new one that only you know before continuing.">
          <PasswordForm forced />
        </Card>
      </>
    );
  }

  // The two-factor card is the second child in both layouts below, so its panel (holding freshly
  // issued recovery codes) survives the re-render that enabling two-factor causes.
  const twoFactor = (
    <Card
      title={account.pending === "two-factor" ? "Set up two-factor sign-in" : "Two-factor sign-in"}
      description={
        account.pending === "two-factor"
          ? "Owner accounts can see costs, profit and every branch, so they need a code from your phone as well as the password."
          : account.twoFactorRequired
            ? "Required for owner accounts."
            : "Recommended. Stops someone who learns your password from signing in."
      }
      aside={account.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
    >
      <TwoFactorPanel enabled={account.twoFactorEnabled} required={account.twoFactorRequired} forced={account.pending === "two-factor"} recoveryCodesLeft={account.recoveryCodesLeft} />
    </Card>
  );

  if (account.pending === "two-factor") {
    return (
      <>
        {header}
        {twoFactor}
      </>
    );
  }

  return (
    <>
      {header}
      {twoFactor}
      <Card title="Password" description={account.passwordChangedAt ? `Last changed ${when.format(new Date(account.passwordChangedAt))}.` : undefined}>
        <PasswordForm forced={false} />
      </Card>
      <Card
        title="Devices"
        description={`Signed-in devices stay signed in for up to 12 hours.${account.lastLoginAt ? ` Your last sign-in: ${when.format(new Date(account.lastLoginAt))}.` : ""} Changing your password or two-factor also signs out your other devices.`}
      >
        <SignOutOthersButton />
      </Card>
    </>
  );
}
