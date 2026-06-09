CREATE INDEX "user_table_rows_table_id_id_idx" ON "user_table_rows" USING btree ("table_id","id");--> statement-breakpoint
-- All tenants' rows share this one relation, so the default autovacuum trigger (~20% of the whole
-- relation dead) lets a single tenant's mass delete leave their reads degraded for days. Vacuum at
-- ~2% churn instead; runs are frequent but cheap (the visibility map skips untouched pages).
ALTER TABLE "user_table_rows" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
