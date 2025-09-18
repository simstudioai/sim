CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"description" text,
	"transport" text NOT NULL,
	"url" text,
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
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_enabled_idx" ON "mcp_servers" USING btree ("workspace_id","enabled");--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_deleted_idx" ON "mcp_servers" USING btree ("workspace_id","deleted_at");