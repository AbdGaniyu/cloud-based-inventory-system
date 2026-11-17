import cron from "node-cron";

/**
 * Local stand-in for Vercel Cron (CLAUDE.md §9): calls the cron routes on the running dev server
 * on the production schedule, in Africa/Lagos time.
 *
 *   pnpm cron:local                          keep running on schedule
 *   pnpm cron:local --run stock-alerts       run one job now and exit
 *   pnpm cron:local --run all                run every job now and exit
 */

const TIMEZONE = "Africa/Lagos";
const JOBS = {
  "stock-alerts": "0 7 * * *",
  "installment-reminders": "0 8 * * *",
  "overdue-escalation": "0 9 * * *",
  "retry-notifications": "*/15 * * * *",
} as const;
type JobName = keyof typeof JOBS;

const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set. Add it to .env (any long random string) and restart the dev server.");
  process.exit(1);
}

async function trigger(name: JobName): Promise<boolean> {
  const started = Date.now();
  try {
    const response = await fetch(`${appUrl}/api/cron/${name}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = await response.text();
    const line = `[${new Date().toISOString()}] ${name} → ${response.status} in ${Date.now() - started}ms ${body}`;
    if (response.ok) console.info(line);
    else console.error(line);
    return response.ok;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${name} → could not reach ${appUrl} (is \`pnpm dev\` running?)`, error instanceof Error ? error.message : error);
    return false;
  }
}

const isJob = (value: string): value is JobName => value in JOBS;
const runIndex = process.argv.indexOf("--run");

async function main(): Promise<void> {
  if (runIndex !== -1) {
    const target = process.argv[runIndex + 1] ?? "";
    const names = target === "all" ? (Object.keys(JOBS) as JobName[]) : isJob(target) ? [target] : [];
    if (names.length === 0) {
      console.error(`Unknown job "${target}". Use one of: all, ${Object.keys(JOBS).join(", ")}`);
      process.exit(1);
    }
    let ok = true;
    for (const name of names) ok = (await trigger(name)) && ok;
    process.exit(ok ? 0 : 1);
  }
  for (const [name, expression] of Object.entries(JOBS) as [JobName, string][]) {
    cron.schedule(expression, () => void trigger(name), { timezone: TIMEZONE, name, noOverlap: true });
    console.info(`Scheduled ${name} at "${expression}" (${TIMEZONE})`);
  }
  console.info(`Calling ${appUrl}. Press Ctrl+C to stop.`);
}

void main();
