-- Grant info@aacflow.io every feature: platform admin, super-user mode,
-- an active Enterprise subscription, and an effectively-unlimited usage limit.
-- Idempotent. Run: psql "$DATABASE_URL" -f scripts/grant-all-features.sql
-- Override target with: psql -v email=other@x.io ...

\set email '''info@aacflow.io'''

-- Platform admin + verified email
UPDATE "user"
SET role = 'admin', email_verified = true, updated_at = NOW()
WHERE lower(email) = lower(:email);

-- Super-user mode (internal features)
INSERT INTO settings (id, user_id, super_user_mode_enabled, updated_at)
SELECT 'admin-' || u.id, u.id, true, NOW()
FROM "user" u
WHERE lower(u.email) = lower(:email)
ON CONFLICT (user_id) DO UPDATE SET super_user_mode_enabled = true, updated_at = NOW();

-- Active Enterprise subscription (replace any existing personal sub)
DELETE FROM subscription
WHERE reference_id = (SELECT id FROM "user" WHERE lower(email) = lower(:email));

INSERT INTO subscription (
  id, plan, reference_id, status, period_start, period_end,
  seats, billing_interval, billing_provider, lago_customer_id, lago_subscription_id, metadata
)
SELECT
  'aacworkflow:' || u.id, 'enterprise', u.id, 'active', NOW(), NOW() + INTERVAL '100 years',
  100, 'month', 'lago', u.id, 'aacworkflow:' || u.id, '{}'::json
FROM "user" u
WHERE lower(u.email) = lower(:email);

-- Effectively-unlimited usage limit + credit balance
UPDATE user_stats
SET current_usage_limit = 1000000,
    credit_balance = 1000000,
    usage_limit_updated_at = NOW()
WHERE user_id = (SELECT id FROM "user" WHERE lower(email) = lower(:email));

-- Report
SELECT u.email, u.role, s.super_user_mode_enabled AS super_user,
       sub.plan, sub.status, sub.seats, st.current_usage_limit AS usage_limit
FROM "user" u
LEFT JOIN settings s ON s.user_id = u.id
LEFT JOIN subscription sub ON sub.reference_id = u.id
LEFT JOIN user_stats st ON st.user_id = u.id
WHERE lower(u.email) = lower(:email);
