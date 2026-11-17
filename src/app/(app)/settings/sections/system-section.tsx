"use client";

import { Activity, BellRing, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { testAlert } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/status-badge";
import type { SystemStatus } from "@/server/services/system.service";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const JOB_TONE: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: "success", label: "On schedule" },
  stale: { tone: "warning", label: "Not running on schedule" },
  failing: { tone: "danger", label: "Failing" },
  never: { tone: "neutral", label: "Never run" },
};

/** Settings → System: is the app healthy, are the scheduled jobs running, what broke recently. */
export function SystemSection({ status }: { status: SystemStatus }) {
  const [pending, startTransition] = useTransition();
  const overall = status.health.status === "ok" ? { tone: "success" as const, label: "Healthy" } : { tone: "warning" as const, label: "Needs attention" };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="health-heading" className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="health-heading" className="flex items-center gap-2 text-h2">
            <Activity aria-hidden className="size-5" /> System health
          </h2>
          <Badge tone={overall.tone}>{overall.label}</Badge>
        </div>
        <dl className="mt-4 grid gap-4 text-body sm:grid-cols-4">
          <div><dt className="text-small text-muted-foreground">Database</dt><dd className="font-medium">{status.health.database === "ok" ? "Answering" : "Down"}</dd></div>
          <div><dt className="text-small text-muted-foreground">Server errors (24 h)</dt><dd className={status.errorsLast24h ? "font-medium text-danger" : "font-medium"}>{status.errorsLast24h}</dd></div>
          <div><dt className="text-small text-muted-foreground">Failed messages (24 h)</dt><dd className={status.failedMessagesLast24h ? "font-medium text-warning" : "font-medium"}>{status.failedMessagesLast24h}</dd></div>
          <div><dt className="text-small text-muted-foreground">Version</dt><dd className="font-mono">{status.health.version ?? "local"}</dd></div>
        </dl>
        <p className="mt-3 text-small text-muted-foreground">
          Uptime monitors and your host can poll <span className="font-mono">/api/health</span>: 200 while the database answers (status “degraded” if a job is late), 503 when it does not.
        </p>
      </section>

      <section aria-labelledby="jobs-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="jobs-heading" className="mb-3 text-h3">Scheduled jobs</h2>
        <ul className="divide-y divide-border">
          {status.jobs.map((j) => (
            <li key={j.job} className="flex flex-wrap items-center gap-3 py-2.5 text-body">
              <span className="min-w-56 flex-1 font-medium">{j.label}</span>
              <Badge tone={JOB_TONE[j.status].tone}>{JOB_TONE[j.status].label}</Badge>
              <span className="w-56 text-small text-muted-foreground">{j.lastSuccessAt ? `Last success ${when.format(new Date(j.lastSuccessAt))}` : "No successful run yet"}</span>
              {j.lastError && <span className="w-full text-small text-danger">{j.lastError}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="alerts-heading" className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="alerts-heading" className="text-h3">Alerts to you</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || (!status.channels.webhook && !status.channels.phone)}
            onClick={() =>
              startTransition(async () => {
                const r = await testAlert();
                if (!r.ok) return void toast.error(r.error);
                if (r.data.sent) toast.success(`Test alert sent (${r.data.channels.join(" and ")})`);
                else toast.error("The test alert did not go out. Check the server log.");
              })
            }
          >
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : <BellRing aria-hidden data-icon="inline-start" />} Send test alert
          </Button>
        </div>
        <p className="mt-1 text-small text-muted-foreground">Failing or late jobs, bursts of failed customer messages and unexpected server errors, at most once an hour each.</p>
        <ul className="mt-3 flex flex-col gap-1 text-body">
          <li>Webhook (Slack, Discord, …): {status.channels.webhook ? <Badge tone="success" dot={false}>Set</Badge> : <Badge tone="neutral" dot={false}>Not set: ALERT_WEBHOOK_URL</Badge>}</li>
          <li>SMS to: {status.channels.phone ? <span className="font-mono">{status.channels.phone}</span> : <Badge tone="neutral" dot={false}>Not set: ALERT_PHONE</Badge>}</li>
        </ul>
      </section>

      <section aria-labelledby="errors-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="errors-heading" className="mb-3 text-h3">Recent server errors</h2>
        {status.errors.length === 0 ? (
          <p className="text-body text-muted-foreground">No unexpected errors recorded in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {status.errors.map((e) => (
              <li key={e.id} className="py-2.5 text-small">
                <p className="flex flex-wrap gap-2">
                  <span className="tabular-nums text-muted-foreground">{when.format(new Date(e.createdAt))}</span>
                  <Badge tone="neutral" dot={false}>{e.source}</Badge>
                  {e.route && <span className="font-mono">{e.route}</span>}
                </p>
                <p className="mt-0.5 break-words">{e.message}</p>
                {e.digest && <p className="font-mono text-[11px] text-muted-foreground">digest {e.digest}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
