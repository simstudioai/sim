CREATE TABLE "table_views" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "table_views" ADD CONSTRAINT "table_views_table_id_user_table_definitions_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."user_table_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_views" ADD CONSTRAINT "table_views_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_views" ADD CONSTRAINT "table_views_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_views_table_created_idx" ON "table_views" USING btree ("table_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "table_views_table_default_unique" ON "table_views" USING btree ("table_id") WHERE is_default = true;