CREATE TABLE "managed_agent_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"last_verified_at" timestamp,
	"last_verification_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_agent_connection" ADD CONSTRAINT "managed_agent_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_agent_connection" ADD CONSTRAINT "managed_agent_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_agent_connection_workspace_id_idx" ON "managed_agent_connection" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_agent_connection_workspace_name_unique" ON "managed_agent_connection" USING btree ("workspace_id","name");