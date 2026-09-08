CREATE TABLE "slack_search_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"app_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"enterprise_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"credential_version" text NOT NULL,
	"revision" text NOT NULL,
	"last_outcome" text,
	"last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_search_installation" ADD CONSTRAINT "slack_search_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_search_installation" ADD CONSTRAINT "slack_search_installation_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_search_installation_organization_idx" ON "slack_search_installation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_installation_credential_unique" ON "slack_search_installation" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_search_installation_app_team_unique" ON "slack_search_installation" USING btree ("app_id","team_id");