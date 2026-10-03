-- migration-safe: data-only backfill after table creation began seeding default views;
-- empty config inherits legacy table metadata until each layout field is explicitly saved.
-- Idempotent on replay and safe against concurrent default creation through the partial unique index.
INSERT INTO "table_views" (
	"id",
	"table_id",
	"workspace_id",
	"name",
	"config",
	"is_default",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	gen_random_uuid()::text,
	t."id",
	t."workspace_id",
	'Default',
	'{}'::jsonb,
	true,
	t."created_by",
	t."created_at",
	now()
FROM "user_table_definitions" t
WHERE NOT EXISTS (
	SELECT 1
	FROM "table_views" v
	WHERE v."table_id" = t."id"
		AND v."is_default" = true
)
ON CONFLICT ("table_id") WHERE "is_default" = true DO NOTHING;
