CREATE TABLE "workspace_visit" (
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"visited_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_visit_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_visit" ADD CONSTRAINT "workspace_visit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_visit" ADD CONSTRAINT "workspace_visit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_visit_workspace_idx" ON "workspace_visit" USING btree ("workspace_id");