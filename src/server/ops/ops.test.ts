import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";
import { sendOpsAlert } from "@/server/ops/alerts";
import { reportError } from "@/server/ops/errors";
import { checkOpsHealth, healthReport, jobHealth, runTrackedJob } from "@/server/ops/jobs";
import { resetDatabase } from "@/test/db";

const T0 = new Date("2026-11-17T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

describe("operations monitoring", () => {
  let posts: { url: string; body: { text: string } }[];

  beforeEach(async () => {
    await resetDatabase();
    posts = [];
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.test/ops");
    vi.stubEnv("ALERT_PHONE", "");
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) as { text: string } });
      return new Response("ok");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records each job run, and on failure stores the error, alerts and re-throws", async () => {
    expect(await runTrackedJob("stock-alerts", async () => ({ opened: 2 }))).toEqual({ opened: 2 });
    expect(await db.jobRun.findFirstOrThrow({ where: { ok: true } })).toMatchObject({ job: "stock-alerts", summary: { opened: 2 } });

    await expect(runTrackedJob("overdue-escalation", async () => Promise.reject(new Error("database timeout")))).rejects.toThrow("database timeout");
    expect(await db.jobRun.findFirstOrThrow({ where: { ok: false } })).toMatchObject({ job: "overdue-escalation", error: "database timeout" });
    expect(await db.errorEvent.findFirstOrThrow()).toMatchObject({ source: "job", route: "/api/cron/overdue-escalation", message: "database timeout" });
    expect(posts.some((p) => p.body.text.includes("Scheduled job failed: Overdue escalation"))).toBe(true);
  });

  it("alerts about a job that never ran once scheduling has been live longer than its window", async () => {
    await db.jobRun.create({ data: { job: "retry-notifications", startedAt: hours(-30), finishedAt: hours(-30), ok: true } });
    await db.jobRun.create({ data: { job: "retry-notifications", startedAt: hours(-0.1), finishedAt: hours(-0.1), ok: true } });
    const result = await checkOpsHealth(T0);
    expect(result.staleJobs.sort()).toEqual(["installment-reminders", "overdue-escalation", "stock-alerts"]);
    expect(posts.some((p) => p.body.text.includes("Stock alerts (daily 07:00) is not running at all"))).toBe(true);
  });

  it("calls a job stale once its last success is older than its schedule allows, and failing after a failed run", async () => {
    expect((await jobHealth(T0)).find((j) => j.job === "stock-alerts")?.status).toBe("never");
    await db.jobRun.create({ data: { job: "stock-alerts", startedAt: T0, finishedAt: T0, ok: true } });
    await db.jobRun.create({ data: { job: "retry-notifications", startedAt: T0, finishedAt: T0, ok: true } });
    const later = await jobHealth(hours(1));
    expect(later.find((j) => j.job === "stock-alerts")?.status).toBe("ok");
    expect(later.find((j) => j.job === "retry-notifications")?.status).toBe("stale");
    expect((await jobHealth(hours(27))).find((j) => j.job === "stock-alerts")?.status).toBe("stale");
    await db.jobRun.create({ data: { job: "stock-alerts", startedAt: hours(2), finishedAt: hours(2), ok: false, error: "boom" } });
    expect((await jobHealth(hours(3))).find((j) => j.job === "stock-alerts")).toMatchObject({ status: "failing", lastError: "boom" });
  });

  it("sends each kind of alert at most once an hour and mentions how many were held back", async () => {
    expect(await sendOpsAlert("messages-failing", "Messages failing", [], { now: T0 })).toMatchObject({ sent: true, channels: ["webhook"] });
    expect(await sendOpsAlert("messages-failing", "Messages failing", [], { now: hours(0.5) })).toMatchObject({ sent: false });
    expect(await sendOpsAlert("other-kind", "Something else", [], { now: hours(0.5) })).toMatchObject({ sent: true });
    expect(await sendOpsAlert("messages-failing", "Messages failing", [], { now: hours(1.1) })).toMatchObject({ sent: true });
    expect(posts).toHaveLength(3);
    expect(posts[2].body.text).toContain("(1 more like this since the last alert)");
  });

  it("stores errors without query strings and never throws", async () => {
    await reportError(new Error("PDF render crashed"), { source: "route", route: "/api/pdf/invoice/abc?exp=1&sig=secret" });
    expect(await db.errorEvent.findFirstOrThrow()).toMatchObject({ route: "/api/pdf/invoice/abc", message: "PDF render crashed" });
    await expect(reportError("plain string", { source: "action" })).resolves.toBeUndefined();
  });

  it("alerts on a burst of failed messages and reports degraded health for stale jobs", async () => {
    const customer = await db.customer.create({ data: { name: "Ada", phoneE164: "+2348031234567" } });
    await db.notificationLog.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        customerId: customer.id,
        templateKey: "receipt",
        channel: "SMS" as const,
        provider: "termii",
        to: customer.phoneE164,
        body: "x",
        status: "FAILED" as const,
        failedAt: hours(-0.5),
        dedupeKey: `k${i}`,
      })),
    });
    const result = await checkOpsHealth(T0);
    expect(result.failedMessagesLastHour).toBe(5);
    expect(posts.some((p) => p.body.text.includes("5 customer messages failed"))).toBe(true);
    expect((await healthReport(T0)).status).toBe("degraded"); // jobs have never run
    expect(posts.some((p) => p.body.text.includes("not running at all"))).toBe(false); // fresh install: no false alarm
    for (const job of ["stock-alerts", "installment-reminders", "overdue-escalation", "retry-notifications"]) {
      await db.jobRun.create({ data: { job, startedAt: T0, finishedAt: T0, ok: true } });
    }
    expect(await healthReport(hours(0.2))).toMatchObject({ status: "ok", database: "ok" });
  });
});
