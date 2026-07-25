ALTER TABLE "user_table_definitions" ADD COLUMN "schema_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "insert_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "update_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD COLUMN "delete_locked" boolean DEFAULT false NOT NULL;