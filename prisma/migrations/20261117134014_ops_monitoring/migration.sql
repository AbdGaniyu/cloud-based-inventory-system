-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "ok" BOOLEAN,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "route" TEXT,
    "message" TEXT NOT NULL,
    "digest" TEXT,
    "stack" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_alerts" (
    "kind" TEXT NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,
    "suppressed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("kind")
);

-- CreateIndex
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs"("job", "started_at");

-- CreateIndex
CREATE INDEX "error_events_created_at_idx" ON "error_events"("created_at");
