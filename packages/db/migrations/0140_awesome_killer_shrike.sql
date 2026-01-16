CREATE TABLE IF NOT EXISTS "user_table_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schema" jsonb NOT NULL,
	"max_rows" integer DEFAULT 10000 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_table_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
-- Add constraints if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_table_definitions_workspace_id_workspace_id_fk') THEN
    ALTER TABLE "user_table_definitions" ADD CONSTRAINT "user_table_definitions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_table_definitions_created_by_user_id_fk') THEN
    ALTER TABLE "user_table_definitions" ADD CONSTRAINT "user_table_definitions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_table_rows_table_id_user_table_definitions_id_fk') THEN
    ALTER TABLE "user_table_rows" ADD CONSTRAINT "user_table_rows_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_table_rows_workspace_id_workspace_id_fk') THEN
    ALTER TABLE "user_table_rows" ADD CONSTRAINT "user_table_rows_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_table_rows_created_by_user_id_fk') THEN
    ALTER TABLE "user_table_rows" ADD CONSTRAINT "user_table_rows_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_table_def_workspace_id_idx" ON "user_table_definitions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_table_def_workspace_name_unique" ON "user_table_definitions" USING btree ("workspace_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_table_rows_table_id_idx" ON "user_table_rows" USING btree ("table_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_table_rows_workspace_id_idx" ON "user_table_rows" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_table_rows_data_gin_idx" ON "user_table_rows" USING gin ("data");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_table_rows_workspace_table_idx" ON "user_table_rows" USING btree ("workspace_id","table_id");
--> statement-breakpoint
-- Create function to increment row count on insert
CREATE OR REPLACE FUNCTION increment_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_table_definitions
  SET row_count = row_count + 1
  WHERE id = NEW.table_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Create trigger for insert (drop first if exists to ensure clean state)
DROP TRIGGER IF EXISTS trg_increment_row_count ON user_table_rows;
CREATE TRIGGER trg_increment_row_count
AFTER INSERT ON user_table_rows
FOR EACH ROW
EXECUTE FUNCTION increment_table_row_count();
--> statement-breakpoint
-- Create function to decrement row count on delete
CREATE OR REPLACE FUNCTION decrement_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_table_definitions
  SET row_count = GREATEST(0, row_count - 1)
  WHERE id = OLD.table_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Create trigger for delete (drop first if exists to ensure clean state)
DROP TRIGGER IF EXISTS trg_decrement_row_count ON user_table_rows;
CREATE TRIGGER trg_decrement_row_count
AFTER DELETE ON user_table_rows
FOR EACH ROW
EXECUTE FUNCTION decrement_table_row_count();
