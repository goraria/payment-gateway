BEGIN;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_payment_idempotency_key ON refunds(payment_id,idempotency_key);
COMMIT;
