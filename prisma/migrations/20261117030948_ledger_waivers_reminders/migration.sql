-- AlterTable
ALTER TABLE "installment_plans" ADD COLUMN     "reminders_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "installment_schedules" ADD COLUMN     "amount_waived" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Waivers and payments together never exceed what the row asked for.
ALTER TABLE "installment_schedules" DROP CONSTRAINT "installment_schedules_amounts_check";
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_amounts_check"
  CHECK (sequence > 0 AND amount_due > 0 AND amount_paid >= 0 AND amount_waived >= 0 AND amount_paid + amount_waived <= amount_due);
