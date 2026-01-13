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
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
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
CREATE INDEX "user_table_def_deleted_at_idx" ON "user_table_definitions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "user_table_rows_table_id_idx" ON "user_table_rows" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "user_table_rows_workspace_id_idx" ON "user_table_rows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_table_rows_data_gin_idx" ON "user_table_rows" USING gin ("data");--> statement-breakpoint
CREATE INDEX "user_table_rows_workspace_table_idx" ON "user_table_rows" USING btree ("workspace_id","table_id");