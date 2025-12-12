CREATE TABLE "user_rate_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sync_api_requests" integer DEFAULT 0 NOT NULL,
	"async_api_requests" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL,
	"last_request_at" timestamp DEFAULT now() NOT NULL,
	"is_rate_limited" boolean DEFAULT false NOT NULL,
	"rate_limit_reset_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user_rate_limits" ADD CONSTRAINT "user_rate_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;