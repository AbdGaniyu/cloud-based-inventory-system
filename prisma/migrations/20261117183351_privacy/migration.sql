-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "erased_at" TIMESTAMPTZ(3),
ADD COLUMN     "erased_by_id" UUID,
ADD COLUMN     "notice_given_at" TIMESTAMPTZ(3),
ADD COLUMN     "notice_given_by_id" UUID;

-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN     "redacted_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "customers_notice_given_by_id_idx" ON "customers"("notice_given_by_id");

-- CreateIndex
CREATE INDEX "customers_erased_by_id_idx" ON "customers"("erased_by_id");

-- CreateIndex
CREATE INDEX "notification_logs_created_at_idx" ON "notification_logs"("created_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_notice_given_by_id_fkey" FOREIGN KEY ("notice_given_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_erased_by_id_fkey" FOREIGN KEY ("erased_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
