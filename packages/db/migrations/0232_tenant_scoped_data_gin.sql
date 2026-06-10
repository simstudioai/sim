-- Tenant-scoped containment index: a plain GIN on data matches @> candidates across every
-- tenant sharing this relation (measured 1.07M candidates fetched for a 33k-row match). btree_gin
-- lets table_id lead the GIN so the intersection happens inside the index, and jsonb_path_ops
-- indexes whole key->value paths (single lookup, smaller index). Every @> query carries table_id,
-- so the old cross-tenant index is strictly redundant.
CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint
DROP INDEX "user_table_rows_data_gin_idx";--> statement-breakpoint
CREATE INDEX "user_table_rows_tenant_data_gin_idx" ON "user_table_rows" USING gin ("table_id","data" jsonb_path_ops);