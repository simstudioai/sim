CREATE TABLE "user_table_definitions" (
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
CREATE TABLE "user_table_rows" (
    "id" text PRIMARY KEY NOT NULL,
    "table_id" text NOT NULL,
    "workspace_id" text NOT NULL,
    "data" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "created_by" text
);
--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD CONSTRAINT "user_table_definitions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_table_definitions" ADD CONSTRAINT "user_table_definitions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_table_rows" ADD CONSTRAINT "user_table_rows_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_table_rows" ADD CONSTRAINT "user_table_rows_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_table_rows" ADD CONSTRAINT "user_table_rows_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_table_def_workspace_id_idx" ON "user_table_definitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_table_def_workspace_name_unique" ON "user_table_definitions" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "user_table_rows_table_id_idx" ON "user_table_rows" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "user_table_rows_workspace_id_idx" ON "user_table_rows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_table_rows_data_gin_idx" ON "user_table_rows" USING gin ("data");--> statement-breakpoint
CREATE INDEX "user_table_rows_workspace_table_idx" ON "user_table_rows" USING btree ("workspace_id","table_id");--> statement-breakpoint

-- Trigger function to increment row_count on INSERT
CREATE OR REPLACE FUNCTION increment_user_table_row_count()
RETURNS TRIGGER AS $$
DECLARE
    current_count INTEGER;
    max_allowed INTEGER;
BEGIN
    -- Get current count and max_rows
    SELECT row_count, max_rows INTO current_count, max_allowed
    FROM user_table_definitions
    WHERE id = NEW.table_id;

    -- Check if we would exceed max_rows
    IF current_count >= max_allowed THEN
        RAISE EXCEPTION 'Maximum row limit (%) reached for table %', max_allowed, NEW.table_id;
    END IF;

    -- Increment the row count
    UPDATE user_table_definitions
    SET row_count = row_count + 1,
        updated_at = now()
    WHERE id = NEW.table_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Trigger function to decrement row_count on DELETE
CREATE OR REPLACE FUNCTION decrement_user_table_row_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE user_table_definitions
    SET row_count = GREATEST(row_count - 1, 0),
        updated_at = now()
    WHERE id = OLD.table_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Create trigger for INSERT
CREATE TRIGGER user_table_rows_insert_trigger
    BEFORE INSERT ON user_table_rows
    FOR EACH ROW
    EXECUTE FUNCTION increment_user_table_row_count();
--> statement-breakpoint

-- Create trigger for DELETE
CREATE TRIGGER user_table_rows_delete_trigger
    AFTER DELETE ON user_table_rows
    FOR EACH ROW
    EXECUTE FUNCTION decrement_user_table_row_count();