CREATE TABLE "resource_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"document" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_policy" ADD CONSTRAINT "resource_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_policy" ADD CONSTRAINT "resource_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_policy" ADD CONSTRAINT "resource_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_policy_resource_unique" ON "resource_policy" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "resource_policy_workspace_id_idx" ON "resource_policy" USING btree ("workspace_id");