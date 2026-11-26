CREATE TABLE IF NOT EXISTS commerce_delivery (
 id text PRIMARY KEY,payment_id uuid NOT NULL REFERENCES payments(id),order_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('capture','failed','refund')),amount_minor bigint NOT NULL CHECK(amount_minor>=0),currency text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS commerce_delivery_pending_idx ON commerce_delivery(available_at,id) WHERE delivered_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commerce_payment_order_unique ON payments(reference_id) WHERE application IN ('marketplace','restaurant') AND reference_type='order';
