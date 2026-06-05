ALTER TABLE "user_table_rows" ADD COLUMN "order_key" text;--> statement-breakpoint
CREATE INDEX "user_table_rows_table_order_key_idx" ON "user_table_rows" USING btree ("table_id","order_key","id");