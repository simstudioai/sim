CREATE TABLE "organization_search_history" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "organization_search_history_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_search_history" ADD CONSTRAINT "organization_search_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_search_history" ADD CONSTRAINT "organization_search_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_search_history_user_idx" ON "organization_search_history" USING btree ("user_id");