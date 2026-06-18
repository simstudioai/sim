CREATE TABLE "public_share" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text,
	"token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_share" ADD CONSTRAINT "public_share_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_share" ADD CONSTRAINT "public_share_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_share_token_unique" ON "public_share" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "public_share_resource_unique" ON "public_share" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "public_share_resource_id_idx" ON "public_share" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "public_share_workspace_id_idx" ON "public_share" USING btree ("workspace_id");