CREATE TABLE "template_stars" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"template_id" text NOT NULL,
	"starred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"author" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT '#3972F6' NOT NULL,
	"icon" text DEFAULT 'FileText' NOT NULL,
	"category" text NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "workspace_member" CASCADE;--> statement-breakpoint
ALTER TABLE "template_stars" ADD CONSTRAINT "template_stars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_stars" ADD CONSTRAINT "template_stars_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_stars_user_id_idx" ON "template_stars" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "template_stars_template_id_idx" ON "template_stars" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_stars_user_template_idx" ON "template_stars" USING btree ("user_id","template_id");--> statement-breakpoint
CREATE INDEX "template_stars_template_user_idx" ON "template_stars" USING btree ("template_id","user_id");--> statement-breakpoint
CREATE INDEX "template_stars_starred_at_idx" ON "template_stars" USING btree ("starred_at");--> statement-breakpoint
CREATE INDEX "template_stars_template_starred_at_idx" ON "template_stars" USING btree ("template_id","starred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_stars_user_template_unique" ON "template_stars" USING btree ("user_id","template_id");--> statement-breakpoint
CREATE INDEX "templates_workflow_id_idx" ON "templates" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "templates_user_id_idx" ON "templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "templates_category_idx" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "templates_views_idx" ON "templates" USING btree ("views");--> statement-breakpoint
CREATE INDEX "templates_stars_idx" ON "templates" USING btree ("stars");--> statement-breakpoint
CREATE INDEX "templates_category_views_idx" ON "templates" USING btree ("category","views");--> statement-breakpoint
CREATE INDEX "templates_category_stars_idx" ON "templates" USING btree ("category","stars");--> statement-breakpoint
CREATE INDEX "templates_user_category_idx" ON "templates" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "templates_created_at_idx" ON "templates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "templates_updated_at_idx" ON "templates" USING btree ("updated_at");