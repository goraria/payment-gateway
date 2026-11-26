CREATE TYPE "payment_method_type" AS ENUM('card', 'bank_account', 'wallet', 'qr', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "payment_status" AS ENUM('pending', 'requires_action', 'authorized', 'processing', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "reconciliation_status" AS ENUM('pending', 'matched', 'mismatched', 'resolved');--> statement-breakpoint
CREATE TYPE "refund_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "transaction_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "transaction_type" AS ENUM('authorization', 'capture', 'charge', 'void', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "webhook_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TABLE "payment_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_customer_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"payment_id" uuid NOT NULL,
	"transaction_id" uuid,
	"refund_id" uuid,
	"event_type" varchar(128) NOT NULL,
	"from_status" varchar(64),
	"to_status" varchar(64),
	"provider_reference" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"customer_id" uuid,
	"provider" varchar(64) NOT NULL,
	"provider_payment_method_id" text NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"brand" varchar(32),
	"last_four" varchar(4),
	"expiry_month" integer,
	"expiry_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"billing_details" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payment_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"adapter" varchar(128) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}' NOT NULL,
	"secret_reference" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" varchar(64) NOT NULL,
	"provider_reference" text NOT NULL,
	"status" "reconciliation_status" DEFAULT 'pending'::"reconciliation_status" NOT NULL,
	"currency" varchar(3) NOT NULL,
	"expected_amount" bigint NOT NULL,
	"actual_amount" bigint NOT NULL,
	"difference_amount" bigint DEFAULT 0 NOT NULL,
	"period_started_at" timestamp NOT NULL,
	"period_ended_at" timestamp NOT NULL,
	"reconciled_at" timestamp,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"payment_id" uuid NOT NULL,
	"provider_transaction_id" text,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'pending'::"transaction_status" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"failure_code" varchar(128),
	"failure_message" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_amount_check" CHECK ("amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"payment_method_id" uuid,
	"application" varchar(64) NOT NULL,
	"reference_type" varchar(64) NOT NULL,
	"reference_id" text NOT NULL,
	"provider" varchar(64) NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending'::"payment_status" NOT NULL,
	"amount" bigint NOT NULL,
	"amount_captured" bigint DEFAULT 0 NOT NULL,
	"amount_refunded" bigint DEFAULT 0 NOT NULL,
	"currency" varchar(3) NOT NULL,
	"description" text,
	"failure_code" varchar(128),
	"failure_message" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"authorized_at" timestamp,
	"captured_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("amount" >= 0),
	CONSTRAINT "payments_amount_captured_check" CHECK ("amount_captured" >= 0),
	CONSTRAINT "payments_amount_refunded_check" CHECK ("amount_refunded" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"payment_id" uuid NOT NULL,
	"transaction_id" uuid,
	"requested_by_user_id" uuid,
	"provider_refund_id" text,
	"status" "refund_status" DEFAULT 'pending'::"refund_status" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" text,
	"failure_message" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"external_user_id" text NOT NULL UNIQUE,
	"name" text DEFAULT '' NOT NULL,
	"username" varchar(32) UNIQUE,
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"email" varchar(255) NOT NULL UNIQUE,
	"image" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"webhook_event_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "webhook_status" NOT NULL,
	"response_status" integer,
	"error" text,
	"scheduled_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" varchar(64) NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"status" "webhook_status" DEFAULT 'pending'::"webhook_status" NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_customers_user_provider_key" ON "payment_customers" ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_customers_provider_customer_key" ON "payment_customers" ("provider","provider_customer_id");--> statement-breakpoint
CREATE INDEX "payment_history_payment_created_at_idx" ON "payment_history" ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_provider_reference_key" ON "payment_methods" ("provider","provider_payment_method_id");--> statement-breakpoint
CREATE INDEX "payment_methods_user_default_idx" ON "payment_methods" ("user_id","is_default");--> statement-breakpoint
CREATE INDEX "payment_methods_customer_id_idx" ON "payment_methods" ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_providers_code_key" ON "payment_providers" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reconciliations_provider_reference_key" ON "payment_reconciliations" ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "payment_reconciliations_status_period_idx" ON "payment_reconciliations" ("status","period_started_at","period_ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_provider_reference_key" ON "payment_transactions" ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_payment_created_at_idx" ON "payment_transactions" ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_transactions_status_created_at_idx" ON "payment_transactions" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_key" ON "payments" ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_user_created_at_idx" ON "payments" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" ("application","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "payments_status_created_at_idx" ON "payments" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_reference_key" ON "refunds" ("provider_refund_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_created_at_idx" ON "refunds" ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_status_created_at_idx" ON "refunds" ("status","created_at");--> statement-breakpoint
CREATE INDEX "users_last_seen_at_idx" ON "users" ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_attempts_event_number_key" ON "webhook_attempts" ("webhook_event_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_key" ON "webhook_events" ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events" ("status","received_at");--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_transaction_id_payment_transactions_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_refund_id_refunds_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_customer_id_payment_customers_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "payment_customers"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_payment_methods_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transaction_id_payment_transactions_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_user_id_users_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_webhook_event_id_webhook_events_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE;