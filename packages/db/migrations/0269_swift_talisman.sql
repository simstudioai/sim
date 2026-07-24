CREATE TABLE "pi_search_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"capability_hash" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_key_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"max_calls" integer NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"max_output_bytes" integer NOT NULL,
	"settled_output_bytes" integer DEFAULT 0 NOT NULL,
	"reserved_output_bytes" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_generation" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp,
	"revoked_at" timestamp,
	"fingerprint_version" integer NOT NULL,
	"fingerprint_key_id" text NOT NULL,
	"secret_fingerprints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pi_search_capabilities" ADD CONSTRAINT "pi_search_capabilities_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pi_search_capabilities_hash_unique" ON "pi_search_capabilities" USING btree ("capability_hash");--> statement-breakpoint
CREATE INDEX "pi_search_capabilities_expires_at_idx" ON "pi_search_capabilities" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pi_search_capabilities_revoked_at_idx" ON "pi_search_capabilities" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "pi_search_capabilities_workspace_id_idx" ON "pi_search_capabilities" USING btree ("workspace_id");