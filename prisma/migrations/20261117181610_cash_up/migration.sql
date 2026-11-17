-- CreateEnum
CREATE TYPE "cash_up_status" AS ENUM ('SUBMITTED', 'REVIEWED');

-- CreateTable
CREATE TABLE "cash_ups" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "payment_count" INTEGER NOT NULL,
    "opening_float" DECIMAL(14,2) NOT NULL,
    "expected_cash" DECIMAL(14,2) NOT NULL,
    "expected_card" DECIMAL(14,2) NOT NULL,
    "expected_transfer" DECIMAL(14,2) NOT NULL,
    "counted_cash" DECIMAL(14,2) NOT NULL,
    "counted_card" DECIMAL(14,2),
    "counted_transfer" DECIMAL(14,2),
    "cash_variance" DECIMAL(14,2) NOT NULL,
    "card_variance" DECIMAL(14,2),
    "transfer_variance" DECIMAL(14,2),
    "note" TEXT,
    "status" "cash_up_status" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_ups_branch_id_business_date_idx" ON "cash_ups"("branch_id", "business_date");

-- CreateIndex
CREATE INDEX "cash_ups_user_id_branch_id_period_end_idx" ON "cash_ups"("user_id", "branch_id", "period_end");

-- CreateIndex
CREATE INDEX "cash_ups_reviewed_by_id_idx" ON "cash_ups"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "cash_ups_status_idx" ON "cash_ups"("status");

-- AddForeignKey
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Cash-ups reconcile, and their figures are frozen once submitted ────────
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_period_check" CHECK (period_start < period_end);
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_amounts_check" CHECK (
  opening_float >= 0 AND counted_cash >= 0 AND (counted_card IS NULL OR counted_card >= 0)
  AND (counted_transfer IS NULL OR counted_transfer >= 0) AND payment_count >= 0
);
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_variance_check" CHECK (
  cash_variance = counted_cash - opening_float - expected_cash
  AND ((counted_card IS NULL AND card_variance IS NULL) OR card_variance = counted_card - expected_card)
  AND ((counted_transfer IS NULL AND transfer_variance IS NULL) OR transfer_variance = counted_transfer - expected_transfer)
);
ALTER TABLE "cash_ups" ADD CONSTRAINT "cash_ups_review_check" CHECK (
  (status = 'SUBMITTED' AND reviewed_by_id IS NULL AND reviewed_at IS NULL)
  OR (status = 'REVIEWED' AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)
);

-- Only the review may change after submission; a cash-up is never deleted.
CREATE FUNCTION cash_ups_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_ups cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.branch_id, NEW.user_id, NEW.period_start, NEW.period_end, NEW.business_date, NEW.payment_count, NEW.opening_float,
      NEW.expected_cash, NEW.expected_card, NEW.expected_transfer, NEW.counted_cash, NEW.counted_card, NEW.counted_transfer,
      NEW.cash_variance, NEW.card_variance, NEW.transfer_variance, NEW.note, NEW.created_at)
     IS DISTINCT FROM
     (OLD.branch_id, OLD.user_id, OLD.period_start, OLD.period_end, OLD.business_date, OLD.payment_count, OLD.opening_float,
      OLD.expected_cash, OLD.expected_card, OLD.expected_transfer, OLD.counted_cash, OLD.counted_card, OLD.counted_transfer,
      OLD.cash_variance, OLD.card_variance, OLD.transfer_variance, OLD.note, OLD.created_at) THEN
    RAISE EXCEPTION 'a submitted cash-up cannot be changed, only reviewed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'REVIEWED' THEN
    RAISE EXCEPTION 'a reviewed cash-up cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_ups_guard
  BEFORE UPDATE OR DELETE ON "cash_ups"
  FOR EACH ROW EXECUTE FUNCTION cash_ups_guard();
