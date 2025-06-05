CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"state" json NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "templates_data" json DEFAULT '{}'::json;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;