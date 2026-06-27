-- Promote info@aacflow.io to Sim platform super admin.
-- Run when Postgres is up: psql "$DATABASE_URL" -f scripts/promote-platform-admin.sql

UPDATE "user"
SET role = 'admin', "updatedAt" = NOW()
WHERE lower(email) = 'info@aacflow.io';

INSERT INTO settings (id, user_id, super_user_mode_enabled, theme, auto_connect, telemetry_enabled, email_preferences, billing_usage_notifications_enabled, show_training_controls, mothership_environment, error_notifications_enabled, snap_to_grid_size, show_action_bar, copilot_enabled_models, updated_at)
SELECT
  'admin-' || u.id,
  u.id,
  true,
  'system',
  true,
  true,
  '{}'::json,
  true,
  false,
  'default',
  true,
  0,
  true,
  '{}'::jsonb,
  NOW()
FROM "user" u
WHERE lower(u.email) = 'info@aacflow.io'
ON CONFLICT (user_id) DO UPDATE SET super_user_mode_enabled = true, updated_at = NOW();
