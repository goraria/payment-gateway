ALTER TABLE commerce_delivery ADD COLUMN IF NOT EXISTS return_id uuid;
ALTER TABLE commerce_delivery ADD COLUMN IF NOT EXISTS refund_id uuid;
ALTER TABLE commerce_delivery ADD COLUMN IF NOT EXISTS refund_minor bigint;
