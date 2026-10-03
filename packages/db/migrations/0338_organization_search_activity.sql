CREATE TABLE "organization_search_invocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"surface" text NOT NULL,
	"source_types" text[] NOT NULL,
	"result_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_search_invocation_result_count_bounds" CHECK ("organization_search_invocation"."result_count" BETWEEN 0 AND 100),
	CONSTRAINT "organization_search_invocation_source_types_bounds" CHECK (cardinality("organization_search_invocation"."source_types") <= 100)
);
--> statement-breakpoint
ALTER TABLE "organization_search_invocation" ADD CONSTRAINT "organization_search_invocation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_search_invocation" ADD CONSTRAINT "organization_search_invocation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_search_invocation_org_created_idx" ON "organization_search_invocation" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_search_invocation_user_idx" ON "organization_search_invocation" USING btree ("user_id");