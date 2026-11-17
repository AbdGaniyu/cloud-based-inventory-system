-- CreateEnum
CREATE TYPE "stock_adjustment_reason" AS ENUM ('DAMAGED', 'LOST', 'STOLEN', 'FOUND', 'REPAIRED', 'COUNT_CORRECTION', 'OTHER');

-- AlterEnum
ALTER TYPE "unit_status" ADD VALUE 'WRITTEN_OFF';

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "note" TEXT,
    "lines_counted" INTEGER NOT NULL,
    "units_counted" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "serialized_unit_id" UUID,
    "quantity_change" INTEGER NOT NULL,
    "quantity_before" INTEGER,
    "quantity_after" INTEGER,
    "from_status" "unit_status",
    "to_status" "unit_status",
    "reason" "stock_adjustment_reason" NOT NULL,
    "note" TEXT,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "stock_count_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_counts_branch_id_created_at_idx" ON "stock_counts"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_counts_created_by_id_idx" ON "stock_counts"("created_by_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_branch_id_created_at_idx" ON "stock_adjustments"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_adjustments_product_id_idx" ON "stock_adjustments"("product_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_serialized_unit_id_idx" ON "stock_adjustments"("serialized_unit_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_stock_count_id_idx" ON "stock_adjustments"("stock_count_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_created_by_id_idx" ON "stock_adjustments"("created_by_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Stock adjustments are append-only and self-consistent ─────────────────
-- A wrong adjustment is corrected with another one, never edited away.
CREATE FUNCTION stock_adjustments_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_adjustments is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER stock_adjustments_no_update_delete
  BEFORE UPDATE OR DELETE ON "stock_adjustments"
  FOR EACH ROW EXECUTE FUNCTION stock_adjustments_reject_mutation();

-- Either an accessory line (quantities) or a device (statuses), never a mix.
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_shape_check" CHECK (
  (serialized_unit_id IS NULL AND quantity_before IS NOT NULL AND quantity_after IS NOT NULL AND from_status IS NULL AND to_status IS NULL
     AND quantity_after >= 0 AND quantity_after = quantity_before + quantity_change AND quantity_change <> 0)
  OR
  (serialized_unit_id IS NOT NULL AND quantity_before IS NULL AND quantity_after IS NULL AND from_status IS NOT NULL AND to_status IS NOT NULL
     AND from_status <> to_status AND quantity_change BETWEEN -1 AND 1)
);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_unit_cost_check" CHECK (unit_cost >= 0);
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_check" CHECK (lines_counted >= 0 AND units_counted >= 0);
