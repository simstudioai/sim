CREATE TABLE "custom_block" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_url" text,
	"outputs" json,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_block" ADD CONSTRAINT "custom_block_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_block" ADD CONSTRAINT "custom_block_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_block" ADD CONSTRAINT "custom_block_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_block_organization_id_idx" ON "custom_block" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "custom_block_workflow_id_idx" ON "custom_block" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_block_organization_type_unique" ON "custom_block" USING btree ("organization_id","type");