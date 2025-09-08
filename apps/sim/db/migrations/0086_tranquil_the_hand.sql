CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"transport" text NOT NULL,
	"url" text,
	"command" text,
	"args" json,
	"env" json,
	"headers" json DEFAULT '{}',
	"timeout" integer DEFAULT 30000,
	"retries" integer DEFAULT 3,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_connected" timestamp,
	"connection_status" text DEFAULT 'disconnected',
	"last_error" text,
	"tool_count" integer DEFAULT 0,
	"last_tools_refresh" timestamp,
	"total_requests" integer DEFAULT 0,
	"last_used" timestamp,
	"workspace_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_servers_user_id_idx" ON "mcp_servers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_workspace_idx" ON "mcp_servers" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_enabled_idx" ON "mcp_servers" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "mcp_servers_connection_status_idx" ON "mcp_servers" USING btree ("connection_status");--> statement-breakpoint
CREATE INDEX "mcp_servers_deleted_at_idx" ON "mcp_servers" USING btree ("deleted_at");