CREATE TABLE "shopify_installation_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"browser_hash" text NOT NULL,
	"shop_id" text,
	"encrypted_tokens" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"expires_at" timestamp NOT NULL,
	"claimed_by_user_id" text,
	"credential_id" text,
	"workspace_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_installation_scope" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_installation_scope_owner_check" CHECK ("shopify_installation_scope"."owner_type" IN ('workspace', 'organization'))
);
--> statement-breakpoint
CREATE TABLE "shopify_privacy_request" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"topic" text NOT NULL,
	"shop_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"payload_hash" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"assigned_to_user_id" text,
	"encrypted_evidence" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp NOT NULL,
	"triaged_at" timestamp,
	"escalated_at" timestamp,
	"completed_at" timestamp,
	"completed_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_privacy_request_topic_check" CHECK ("shopify_privacy_request"."topic" IN ('customers/data_request', 'customers/redact', 'shop/redact')),
	CONSTRAINT "shopify_privacy_request_status_check" CHECK ("shopify_privacy_request"."status" IN ('received', 'awaiting_review', 'processing', 'legal_hold', 'completed'))
);
--> statement-breakpoint
CREATE INDEX "shopify_installation_attempt_shop_expiry_idx" ON "shopify_installation_attempt" USING btree ("client_id","shop_domain","expires_at");--> statement-breakpoint
CREATE INDEX "shopify_installation_attempt_expires_at_idx" ON "shopify_installation_attempt" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "shopify_installation_attempt_browser_expiry_idx" ON "shopify_installation_attempt" USING btree ("browser_hash","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_installation_scope_association_unique" ON "shopify_installation_scope" USING btree ("client_id","shop_id","owner_type","owner_id","credential_id");--> statement-breakpoint
CREATE INDEX "shopify_installation_scope_shop_idx" ON "shopify_installation_scope" USING btree ("client_id","shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_privacy_request_delivery_unique" ON "shopify_privacy_request" USING btree ("client_id","webhook_id");--> statement-breakpoint
CREATE INDEX "shopify_privacy_request_deadline_idx" ON "shopify_privacy_request" USING btree ("due_at","id") WHERE "shopify_privacy_request"."completed_at" IS NULL AND "shopify_privacy_request"."escalated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shopify_privacy_request_shop_idx" ON "shopify_privacy_request" USING btree ("client_id","shop_id","received_at");