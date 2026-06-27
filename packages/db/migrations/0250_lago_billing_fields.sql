-- migration-safe: adds nullable columns only (no data migration, no breaking changes)
ALTER TABLE subscription
ADD COLUMN IF NOT EXISTS lago_customer_id text,
ADD COLUMN IF NOT EXISTS lago_subscription_id text,
ADD COLUMN IF NOT EXISTS billing_provider text NOT NULL DEFAULT 'stripe';
