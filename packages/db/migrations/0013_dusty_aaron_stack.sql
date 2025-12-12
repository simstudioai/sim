CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"path" text NOT NULL,
	"secret" text,
	"provider" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "path_idx" ON "webhook" USING btree ("path");