CREATE TABLE "organization_search_mcp_invocation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"auth_kind" text NOT NULL,
	"oauth_client_id" text,
	"client_name" text,
	"tool_name" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_search_mcp_invocation_tool_check" CHECK ("organization_search_mcp_invocation"."tool_name" IN ('search', 'read_document', 'chat')),
	CONSTRAINT "organization_search_mcp_invocation_outcome_check" CHECK ("organization_search_mcp_invocation"."outcome" IN ('success', 'error', 'cancelled', 'rate_limited')),
	CONSTRAINT "organization_search_mcp_invocation_duration_check" CHECK ("organization_search_mcp_invocation"."duration_ms" >= 0),
	CONSTRAINT "organization_search_mcp_invocation_client_name_check" CHECK (length("organization_search_mcp_invocation"."client_name") <= 256),
	CONSTRAINT "organization_search_mcp_invocation_auth_check" CHECK (("organization_search_mcp_invocation"."auth_kind" = 'oauth_access_token' AND "organization_search_mcp_invocation"."oauth_client_id" IS NOT NULL)
        OR ("organization_search_mcp_invocation"."auth_kind" IN ('personal_api_key', 'workspace_api_key') AND "organization_search_mcp_invocation"."oauth_client_id" IS NULL AND "organization_search_mcp_invocation"."client_name" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "organization_search_mcp_invocation" ADD CONSTRAINT "org_search_mcp_invocation_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_search_mcp_invocation" ADD CONSTRAINT "org_search_mcp_invocation_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_search_mcp_invocation_org_created_idx" ON "organization_search_mcp_invocation" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_search_mcp_invocation_user_idx" ON "organization_search_mcp_invocation" USING btree ("user_id");