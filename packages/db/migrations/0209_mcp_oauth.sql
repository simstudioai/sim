CREATE TABLE "mcp_server_oauth" (
	"id" text PRIMARY KEY NOT NULL,
	"mcp_server_id" text NOT NULL,
	"user_id" text,
	"workspace_id" text NOT NULL,
	"client_information" text,
	"tokens" text,
	"code_verifier" text,
	"state" text,
	"state_created_at" timestamp,
	"last_refreshed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "auth_type" text DEFAULT 'headers' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "oauth_client_secret" text;--> statement-breakpoint
ALTER TABLE "mcp_server_oauth" ADD CONSTRAINT "mcp_server_oauth_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_oauth" ADD CONSTRAINT "mcp_server_oauth_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_oauth" ADD CONSTRAINT "mcp_server_oauth_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_oauth_server_unique" ON "mcp_server_oauth" USING btree ("mcp_server_id");--> statement-breakpoint
CREATE INDEX "mcp_server_oauth_state_idx" ON "mcp_server_oauth" USING btree ("state");