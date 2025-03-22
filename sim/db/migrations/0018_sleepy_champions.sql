CREATE TABLE "marketplace" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"state" json NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"executions" integer DEFAULT 0 NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_star" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace" ADD CONSTRAINT "marketplace_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace" ADD CONSTRAINT "marketplace_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_execution" ADD CONSTRAINT "marketplace_execution_marketplace_id_marketplace_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_execution" ADD CONSTRAINT "marketplace_execution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_star" ADD CONSTRAINT "marketplace_star_marketplace_id_marketplace_id_fk" FOREIGN KEY ("marketplace_id") REFERENCES "public"."marketplace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_star" ADD CONSTRAINT "marketplace_star_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_marketplace_idx" ON "marketplace_star" USING btree ("user_id","marketplace_id");