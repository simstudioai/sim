CREATE TABLE IF NOT EXISTS "desktop_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"name" text NOT NULL,
	"app_version" text NOT NULL,
	"platform" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "desktop_devices_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_devices_user_id_idx" ON "desktop_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desktop_devices_session_id_idx" ON "desktop_devices" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "desktop_device_id" text;--> statement-breakpoint
-- Every existing run is unbound (NULL), so there is nothing to validate. NOT VALID still checks
-- each new binding while skipping a scan of the populated run table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"public"."copilot_runs"'::regclass
      AND conname = 'copilot_runs_desktop_device_id_desktop_devices_id_fk'
  ) THEN
    ALTER TABLE "copilot_runs" ADD CONSTRAINT "copilot_runs_desktop_device_id_desktop_devices_id_fk"
      FOREIGN KEY ("desktop_device_id") REFERENCES "public"."desktop_devices"("id")
      ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
COMMIT;--> statement-breakpoint
SET lock_timeout = 0;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "copilot_runs_desktop_device_started_at_idx" ON "copilot_runs" USING btree ("desktop_device_id","started_at") WHERE "copilot_runs"."desktop_device_id" IS NOT NULL;
--> statement-breakpoint
SET lock_timeout = '5s';
