CREATE TABLE "mothership_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"artifacts" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"running_stage" text,
	"attempt_id" text,
	"lease_expires_at" timestamp,
	"planner_chat_id" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mothership_benchmarks_version_check" CHECK ("mothership_benchmarks"."version" > 0),
	CONSTRAINT "mothership_benchmarks_attempt_check" CHECK (("mothership_benchmarks"."running_stage" IS NULL AND "mothership_benchmarks"."attempt_id" IS NULL AND "mothership_benchmarks"."lease_expires_at" IS NULL) OR ("mothership_benchmarks"."running_stage" IS NOT NULL AND "mothership_benchmarks"."running_stage" IN ('distill', 'redact', 'plan', 'reconstruct', 'grade') AND "mothership_benchmarks"."attempt_id" IS NOT NULL AND "mothership_benchmarks"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "mothership_benchmarks" ADD CONSTRAINT "mothership_benchmarks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_benchmarks" ADD CONSTRAINT "mothership_benchmarks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_benchmarks" ADD CONSTRAINT "mothership_benchmarks_source_workspace_id_workspace_id_fk" FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mothership_benchmarks_owner_created_idx" ON "mothership_benchmarks" USING btree ("organization_id","user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "mothership_benchmarks_workspace_idx" ON "mothership_benchmarks" USING btree ("source_workspace_id");