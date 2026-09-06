CREATE TABLE "copilot_request_stops" (
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_request_stops_user_id_workspace_id_stream_id_pk" PRIMARY KEY("user_id","workspace_id","stream_id")
);
--> statement-breakpoint
ALTER TABLE "copilot_request_stops" ADD CONSTRAINT "copilot_request_stops_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_request_stops" ADD CONSTRAINT "copilot_request_stops_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;