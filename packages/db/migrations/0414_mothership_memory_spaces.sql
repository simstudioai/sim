CREATE TABLE "mothership_memory_selections" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" uuid,
	CONSTRAINT "mothership_memory_selections_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "mothership_memory_spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_chats" ADD COLUMN "memory_space_id" uuid;--> statement-breakpoint
ALTER TABLE "mothership_memory_selections" ADD CONSTRAINT "mothership_memory_selections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_memory_selections" ADD CONSTRAINT "mothership_memory_selections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_memory_selections" ADD CONSTRAINT "mothership_memory_selections_space_id_mothership_memory_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."mothership_memory_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_memory_spaces" ADD CONSTRAINT "mothership_memory_spaces_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mothership_memory_spaces" ADD CONSTRAINT "mothership_memory_spaces_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mothership_memory_spaces_owner_idx" ON "mothership_memory_spaces" USING btree ("user_id","organization_id");