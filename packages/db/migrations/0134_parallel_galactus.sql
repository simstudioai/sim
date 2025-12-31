CREATE TABLE "workflow_mcp_server" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_mcp_tool" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_description" text,
	"parameter_schema" json DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD CONSTRAINT "workflow_mcp_server_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_mcp_server" ADD CONSTRAINT "workflow_mcp_server_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD CONSTRAINT "workflow_mcp_tool_server_id_workflow_mcp_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."workflow_mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_mcp_tool" ADD CONSTRAINT "workflow_mcp_tool_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_workspace_id_idx" ON "workflow_mcp_server" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_mcp_server_created_by_idx" ON "workflow_mcp_server" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_server_id_idx" ON "workflow_mcp_tool" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "workflow_mcp_tool_workflow_id_idx" ON "workflow_mcp_tool" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_mcp_tool_server_workflow_unique" ON "workflow_mcp_tool" USING btree ("server_id","workflow_id");