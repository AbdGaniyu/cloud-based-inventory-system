-- CreateEnum
CREATE TYPE "branch_type" AS ENUM ('STORE', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('OWNER', 'BRANCH_MANAGER', 'CASHIER');

-- CreateEnum
CREATE TYPE "tracking_type" AS ENUM ('SERIALIZED', 'NON_SERIALIZED');

-- CreateEnum
CREATE TYPE "unit_condition" AS ENUM ('BRAND_NEW', 'OPEN_BOX', 'UK_USED', 'US_USED', 'REFURBISHED');

-- CreateEnum
CREATE TYPE "unit_status" AS ENUM ('IN_STOCK', 'IN_TRANSIT', 'SOLD', 'RETURNED', 'DEFECTIVE', 'TRADED_IN');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_terms" AS ENUM ('PAID_IN_FULL', 'PARTIAL_DEPOSIT', 'NET_7', 'NET_15', 'NET_30');

-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'BANK_TRANSFER', 'POS_CARD');

-- CreateEnum
CREATE TYPE "customer_payment_kind" AS ENUM ('CHECKOUT', 'DOWN_PAYMENT', 'INSTALLMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "invoice_payment_type" AS ENUM ('FULL', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID', 'RETURNED');

-- CreateEnum
CREATE TYPE "installment_frequency" AS ENUM ('WEEKLY', 'BI_WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "installment_plan_status" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "schedule_status" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "return_disposition" AS ENUM ('RESTOCK', 'DEFECTIVE');

-- CreateEnum
CREATE TYPE "warranty_status" AS ENUM ('ACTIVE', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "message_channel" AS ENUM ('WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "invoice_adjustment_kind" AS ENUM ('WAIVER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "stock_alert_type" AS ENUM ('LOW_STOCK', 'AGING');

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "branch_type" NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "invoice_sequence" INTEGER NOT NULL DEFAULT 0,
    "transfer_sequence" INTEGER NOT NULL DEFAULT 0,
    "purchase_order_sequence" INTEGER NOT NULL DEFAULT 0,
    "return_sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "branch_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tracking_type" "tracking_type" NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "default_cost_price" DECIMAL(14,2) NOT NULL,
    "default_selling_price" DECIMAL(14,2) NOT NULL,
    "warranty_months" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_inventory" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "reorder_level" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serialized_units" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "imei" TEXT,
    "serial_number" TEXT,
    "branch_id" UUID NOT NULL,
    "condition" "unit_condition" NOT NULL,
    "color" TEXT,
    "storage" TEXT,
    "ram" TEXT,
    "battery_health" INTEGER,
    "cost_price" DECIMAL(14,2) NOT NULL,
    "selling_price" DECIMAL(14,2) NOT NULL,
    "status" "unit_status" NOT NULL DEFAULT 'IN_STOCK',
    "purchase_order_id" UUID,
    "purchase_order_item_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "sold_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "serialized_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "transfer_status" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "shipped_by_id" UUID,
    "received_by_id" UUID,
    "cancelled_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "has_discrepancy" BOOLEAN NOT NULL DEFAULT false,
    "driver_name" TEXT,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "serialized_unit_id" UUID,
    "quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER,
    "discrepancy_note" TEXT,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "payment_terms" "payment_terms" NOT NULL,
    "supplier_reference" TEXT,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_date" DATE,
    "status" "purchase_order_status" NOT NULL DEFAULT 'UNPAID',
    "received_by_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "unit_selling_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "reversal_of_id" UUID,
    "paid_by_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "sms_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "trade_in_credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjusted_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL,
    "payment_type" "invoice_payment_type" NOT NULL,
    "status" "invoice_status" NOT NULL,
    "notes" TEXT,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "serialized_unit_id" UUID,
    "description" TEXT NOT NULL,
    "condition" "unit_condition",
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "warranty_months" INTEGER NOT NULL DEFAULT 0,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "down_payment" DECIMAL(14,2) NOT NULL,
    "financed_amount" DECIMAL(14,2) NOT NULL,
    "number_of_installments" INTEGER NOT NULL,
    "frequency" "installment_frequency" NOT NULL,
    "start_date" DATE NOT NULL,
    "next_due_date" DATE,
    "guarantor_name" TEXT,
    "guarantor_phone" TEXT,
    "id_verification_notes" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "status" "installment_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_schedules" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_due" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "schedule_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "kind" "customer_payment_kind" NOT NULL,
    "reversal_of_id" UUID,
    "notes" TEXT,
    "received_by_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_adjustments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "invoice_adjustment_kind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_ins" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID,
    "description" TEXT NOT NULL,
    "imei" TEXT,
    "serial_number" TEXT,
    "condition" "unit_condition" NOT NULL,
    "credit_amount" DECIMAL(14,2) NOT NULL,
    "serialized_unit_id" UUID,
    "assessed_by_id" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "credit_amount" DECIMAL(14,2) NOT NULL,
    "refund_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "replacement_invoice_id" UUID,
    "processed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "invoice_item_id" UUID NOT NULL,
    "serialized_unit_id" UUID,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "disposition" "return_disposition" NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_cards" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "invoice_item_id" UUID NOT NULL,
    "serialized_unit_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "starts_at" DATE NOT NULL,
    "expires_at" DATE NOT NULL,
    "terms" TEXT NOT NULL,
    "status" "warranty_status" NOT NULL DEFAULT 'ACTIVE',
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warranty_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sms_body" TEXT,
    "whatsapp_template_name" TEXT,
    "whatsapp_template_language" TEXT NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID,
    "template_key" TEXT NOT NULL,
    "channel" "message_channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "media_url" TEXT,
    "status" "notification_status" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupe_key" TEXT NOT NULL,
    "parent_id" UUID,
    "triggered_by_id" UUID,
    "last_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" UUID NOT NULL,
    "type" "stock_alert_type" NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "serialized_unit_id" UUID,
    "dedupe_key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "first_detected_at" TIMESTAMPTZ(3) NOT NULL,
    "last_detected_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "branch_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

-- CreateIndex
CREATE INDEX "branch_inventory_branch_id_idx" ON "branch_inventory"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_inventory_product_id_branch_id_key" ON "branch_inventory"("product_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "serialized_units_imei_key" ON "serialized_units"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "serialized_units_serial_number_key" ON "serialized_units"("serial_number");

-- CreateIndex
CREATE INDEX "serialized_units_product_id_idx" ON "serialized_units"("product_id");

-- CreateIndex
CREATE INDEX "serialized_units_branch_id_status_idx" ON "serialized_units"("branch_id", "status");

-- CreateIndex
CREATE INDEX "serialized_units_purchase_order_id_idx" ON "serialized_units"("purchase_order_id");

-- CreateIndex
CREATE INDEX "serialized_units_purchase_order_item_id_idx" ON "serialized_units"("purchase_order_item_id");

-- CreateIndex
CREATE INDEX "serialized_units_status_received_at_idx" ON "serialized_units"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_number_key" ON "stock_transfers"("number");

-- CreateIndex
CREATE INDEX "stock_transfers_from_branch_id_status_idx" ON "stock_transfers"("from_branch_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_to_branch_id_status_idx" ON "stock_transfers"("to_branch_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_created_by_id_idx" ON "stock_transfers"("created_by_id");

-- CreateIndex
CREATE INDEX "stock_transfers_approved_by_id_idx" ON "stock_transfers"("approved_by_id");

-- CreateIndex
CREATE INDEX "stock_transfers_shipped_by_id_idx" ON "stock_transfers"("shipped_by_id");

-- CreateIndex
CREATE INDEX "stock_transfers_received_by_id_idx" ON "stock_transfers"("received_by_id");

-- CreateIndex
CREATE INDEX "stock_transfers_cancelled_by_id_idx" ON "stock_transfers"("cancelled_by_id");

-- CreateIndex
CREATE INDEX "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");

-- CreateIndex
CREATE INDEX "stock_transfer_items_product_id_idx" ON "stock_transfer_items"("product_id");

-- CreateIndex
CREATE INDEX "stock_transfer_items_serialized_unit_id_idx" ON "stock_transfer_items"("serialized_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_items_transfer_id_serialized_unit_id_key" ON "stock_transfer_items"("transfer_id", "serialized_unit_id");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_branch_id_received_at_idx" ON "purchase_orders"("branch_id", "received_at");

-- CreateIndex
CREATE INDEX "purchase_orders_status_due_date_idx" ON "purchase_orders"("status", "due_date");

-- CreateIndex
CREATE INDEX "purchase_orders_received_by_id_idx" ON "purchase_orders"("received_by_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_product_id_idx" ON "purchase_order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_reversal_of_id_key" ON "supplier_payments"("reversal_of_id");

-- CreateIndex
CREATE INDEX "supplier_payments_purchase_order_id_idx" ON "supplier_payments"("purchase_order_id");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_paid_at_idx" ON "supplier_payments"("supplier_id", "paid_at");

-- CreateIndex
CREATE INDEX "supplier_payments_paid_by_id_idx" ON "supplier_payments"("paid_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_e164_key" ON "customers"("phone_e164");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_created_by_id_idx" ON "customers"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_branch_id_created_at_idx" ON "invoices"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_cashier_id_idx" ON "invoices"("cashier_id");

-- CreateIndex
CREATE INDEX "invoices_voided_by_id_idx" ON "invoices"("voided_by_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_product_id_idx" ON "invoice_items"("product_id");

-- CreateIndex
CREATE INDEX "invoice_items_serialized_unit_id_idx" ON "invoice_items"("serialized_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "installment_plans_invoice_id_key" ON "installment_plans"("invoice_id");

-- CreateIndex
CREATE INDEX "installment_plans_approved_by_id_idx" ON "installment_plans"("approved_by_id");

-- CreateIndex
CREATE INDEX "installment_plans_status_next_due_date_idx" ON "installment_plans"("status", "next_due_date");

-- CreateIndex
CREATE INDEX "installment_schedules_due_date_status_idx" ON "installment_schedules"("due_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "installment_schedules_plan_id_sequence_key" ON "installment_schedules"("plan_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_reversal_of_id_key" ON "customer_payments"("reversal_of_id");

-- CreateIndex
CREATE INDEX "customer_payments_invoice_id_idx" ON "customer_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "customer_payments_customer_id_idx" ON "customer_payments"("customer_id");

-- CreateIndex
CREATE INDEX "customer_payments_branch_id_paid_at_idx" ON "customer_payments"("branch_id", "paid_at");

-- CreateIndex
CREATE INDEX "customer_payments_received_by_id_idx" ON "customer_payments"("received_by_id");

-- CreateIndex
CREATE INDEX "invoice_adjustments_invoice_id_idx" ON "invoice_adjustments"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_adjustments_created_by_id_idx" ON "invoice_adjustments"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_ins_serialized_unit_id_key" ON "trade_ins"("serialized_unit_id");

-- CreateIndex
CREATE INDEX "trade_ins_invoice_id_idx" ON "trade_ins"("invoice_id");

-- CreateIndex
CREATE INDEX "trade_ins_customer_id_idx" ON "trade_ins"("customer_id");

-- CreateIndex
CREATE INDEX "trade_ins_branch_id_idx" ON "trade_ins"("branch_id");

-- CreateIndex
CREATE INDEX "trade_ins_product_id_idx" ON "trade_ins"("product_id");

-- CreateIndex
CREATE INDEX "trade_ins_assessed_by_id_idx" ON "trade_ins"("assessed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_number_key" ON "returns"("number");

-- CreateIndex
CREATE UNIQUE INDEX "returns_replacement_invoice_id_key" ON "returns"("replacement_invoice_id");

-- CreateIndex
CREATE INDEX "returns_invoice_id_idx" ON "returns"("invoice_id");

-- CreateIndex
CREATE INDEX "returns_branch_id_idx" ON "returns"("branch_id");

-- CreateIndex
CREATE INDEX "returns_customer_id_idx" ON "returns"("customer_id");

-- CreateIndex
CREATE INDEX "returns_processed_by_id_idx" ON "returns"("processed_by_id");

-- CreateIndex
CREATE INDEX "return_items_return_id_idx" ON "return_items"("return_id");

-- CreateIndex
CREATE INDEX "return_items_invoice_item_id_idx" ON "return_items"("invoice_item_id");

-- CreateIndex
CREATE INDEX "return_items_serialized_unit_id_idx" ON "return_items"("serialized_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_cards_public_id_key" ON "warranty_cards"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_cards_invoice_item_id_key" ON "warranty_cards"("invoice_item_id");

-- CreateIndex
CREATE INDEX "warranty_cards_serialized_unit_id_idx" ON "warranty_cards"("serialized_unit_id");

-- CreateIndex
CREATE INDEX "warranty_cards_customer_id_idx" ON "warranty_cards"("customer_id");

-- CreateIndex
CREATE INDEX "warranty_cards_branch_id_idx" ON "warranty_cards"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_key_key" ON "message_templates"("key");

-- CreateIndex
CREATE INDEX "message_templates_updated_by_id_idx" ON "message_templates"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_dedupe_key_key" ON "notification_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_logs_customer_id_created_at_idx" ON "notification_logs"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_invoice_id_idx" ON "notification_logs"("invoice_id");

-- CreateIndex
CREATE INDEX "notification_logs_parent_id_idx" ON "notification_logs"("parent_id");

-- CreateIndex
CREATE INDEX "notification_logs_triggered_by_id_idx" ON "notification_logs"("triggered_by_id");

-- CreateIndex
CREATE INDEX "notification_logs_provider_message_id_idx" ON "notification_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_last_attempt_at_idx" ON "notification_logs"("status", "last_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "settings_updated_by_id_idx" ON "settings"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_alerts_dedupe_key_key" ON "stock_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "stock_alerts_branch_id_resolved_at_idx" ON "stock_alerts"("branch_id", "resolved_at");

-- CreateIndex
CREATE INDEX "stock_alerts_product_id_idx" ON "stock_alerts"("product_id");

-- CreateIndex
CREATE INDEX "stock_alerts_serialized_unit_id_idx" ON "stock_alerts"("serialized_unit_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_branch_id_created_at_idx" ON "audit_logs"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_shipped_by_id_fkey" FOREIGN KEY ("shipped_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "supplier_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "customer_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_assessed_by_id_fkey" FOREIGN KEY ("assessed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_replacement_invoice_id_fkey" FOREIGN KEY ("replacement_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_cards" ADD CONSTRAINT "warranty_cards_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_cards" ADD CONSTRAINT "warranty_cards_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_cards" ADD CONSTRAINT "warranty_cards_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_cards" ADD CONSTRAINT "warranty_cards_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "notification_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_serialized_unit_id_fkey" FOREIGN KEY ("serialized_unit_id") REFERENCES "serialized_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written guarantees (Prisma schema language cannot express these).
-- Prisma Migrate ignores CHECK constraints and triggers when diffing, so they
-- survive future generated migrations.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Invariant 7: audit_logs is append-only ─────────────────────────────────
CREATE FUNCTION audit_logs_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();

-- ─── Users: owners are global, everyone else belongs to exactly one branch ──
ALTER TABLE "users" ADD CONSTRAINT "users_branch_matches_role_check"
  CHECK ((role = 'OWNER' AND branch_id IS NULL) OR (role <> 'OWNER' AND branch_id IS NOT NULL));

-- ─── Branch document sequences never go negative ────────────────────────────
ALTER TABLE "branches" ADD CONSTRAINT "branches_sequences_non_negative_check"
  CHECK (invoice_sequence >= 0 AND transfer_sequence >= 0 AND purchase_order_sequence >= 0 AND return_sequence >= 0);

-- ─── Products ───────────────────────────────────────────────────────────────
ALTER TABLE "products" ADD CONSTRAINT "products_values_non_negative_check"
  CHECK (default_cost_price >= 0 AND default_selling_price >= 0 AND warranty_months >= 0 AND reorder_level >= 0);

-- ─── Stock quantities can never go negative (overselling guard) ─────────────
ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_quantities_non_negative_check"
  CHECK (quantity >= 0 AND reserved_quantity >= 0 AND (reorder_level IS NULL OR reorder_level >= 0));

-- ─── Serialized units ───────────────────────────────────────────────────────
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_identifier_present_check"
  CHECK (imei IS NOT NULL OR serial_number IS NOT NULL);
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_battery_health_range_check"
  CHECK (battery_health IS NULL OR battery_health BETWEEN 0 AND 100);
ALTER TABLE "serialized_units" ADD CONSTRAINT "serialized_units_prices_non_negative_check"
  CHECK (cost_price >= 0 AND selling_price >= 0);

-- ─── Transfers ──────────────────────────────────────────────────────────────
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_branches_check"
  CHECK (from_branch_id <> to_branch_id);
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_quantity_check"
  CHECK (
    quantity > 0
    AND (serialized_unit_id IS NULL OR quantity = 1)
    AND (received_quantity IS NULL OR received_quantity BETWEEN 0 AND quantity)
  );

-- ─── Purchase orders ────────────────────────────────────────────────────────
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_amounts_check"
  CHECK (total_cost >= 0 AND amount_paid >= 0 AND amount_paid <= total_cost);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_amounts_check"
  CHECK (quantity > 0 AND unit_cost >= 0 AND unit_selling_price >= 0 AND line_total = quantity * unit_cost);

-- Signed ledger: payouts are positive, reversals are negative and point at the payout they cancel.
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_sign_check"
  CHECK ((reversal_of_id IS NULL AND amount > 0) OR (reversal_of_id IS NOT NULL AND amount < 0));

-- ─── Invoices: cached totals must reconcile (invariant 5) ───────────────────
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_non_negative_check"
  CHECK (
    subtotal >= 0 AND discount >= 0 AND tax_rate >= 0 AND tax_amount >= 0
    AND trade_in_credit >= 0 AND total >= 0 AND returned_amount >= 0
  );
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_reconciles_check"
  CHECK (total = subtotal - discount + tax_amount - trade_in_credit);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_balance_reconciles_check"
  CHECK (balance = total - returned_amount - adjusted_amount - amount_paid);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_void_has_reason_check"
  CHECK (status <> 'VOID' OR (void_reason IS NOT NULL AND voided_by_id IS NOT NULL AND voided_at IS NOT NULL));

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_amounts_check"
  CHECK (
    quantity > 0
    AND (serialized_unit_id IS NULL OR quantity = 1)
    AND unit_price >= 0 AND unit_cost >= 0 AND discount >= 0
    AND line_total = quantity * unit_price - discount
    AND line_total >= 0
    AND returned_quantity BETWEEN 0 AND quantity
    AND warranty_months >= 0
  );

-- ─── Installments ───────────────────────────────────────────────────────────
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_amounts_check"
  CHECK (down_payment >= 0 AND financed_amount > 0 AND number_of_installments > 0);
ALTER TABLE "installment_schedules" ADD CONSTRAINT "installment_schedules_amounts_check"
  CHECK (sequence > 0 AND amount_due > 0 AND amount_paid >= 0 AND amount_paid <= amount_due);

-- Signed ledger: receipts are positive; REFUND rows and reversals are negative.
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_sign_check"
  CHECK (
    (kind <> 'REFUND' AND reversal_of_id IS NULL AND amount > 0)
    OR ((kind = 'REFUND' OR reversal_of_id IS NOT NULL) AND amount < 0)
  );

ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_amount_check"
  CHECK (amount <> 0 AND length(trim(reason)) > 0);

-- ─── Trade-ins, returns, warranty ───────────────────────────────────────────
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_credit_check"
  CHECK (credit_amount >= 0);
ALTER TABLE "returns" ADD CONSTRAINT "returns_amounts_check"
  CHECK (credit_amount >= 0 AND refund_amount >= 0 AND refund_amount <= credit_amount);
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_amounts_check"
  CHECK (quantity > 0 AND (serialized_unit_id IS NULL OR quantity = 1) AND amount >= 0);
ALTER TABLE "warranty_cards" ADD CONSTRAINT "warranty_cards_dates_check"
  CHECK (expires_at >= starts_at);

-- ─── Notifications ──────────────────────────────────────────────────────────
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_attempts_check"
  CHECK (attempts >= 0);
