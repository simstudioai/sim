ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "executable_name" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "target_workspace_id" text;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "approved_args" jsonb;--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "execution_retryable" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "assistant_tool_permission" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"read_policy" text DEFAULT 'allow' NOT NULL,
	"write_policy" text DEFAULT 'ask' NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_tool_permission_organization_id_user_id_credential_id_pk" PRIMARY KEY("organization_id","user_id","credential_id"),
	CONSTRAINT "assistant_tool_permission_policy_check" CHECK ("assistant_tool_permission"."read_policy" IN ('allow', 'ask', 'block') AND "assistant_tool_permission"."write_policy" IN ('allow', 'ask', 'block')),
	CONSTRAINT "assistant_tool_permission_revision_check" CHECK ("assistant_tool_permission"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_tool_permission" ADD CONSTRAINT "assistant_tool_permission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tool_permission" ADD CONSTRAINT "assistant_tool_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tool_permission" ADD CONSTRAINT "assistant_tool_permission_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_tool_permission_credential_idx" ON "assistant_tool_permission" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "assistant_tool_permission_user_idx" ON "assistant_tool_permission" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "copilot_async_tool_calls" ADD COLUMN "assistant_action" jsonb;
