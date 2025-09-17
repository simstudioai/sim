CREATE TYPE "public"."permission_type" AS ENUM('admin', 'write', 'read');--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"permission_type" "permission_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD COLUMN "permissions" "permission_type" DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permissions_user_id_idx" ON "permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permissions_entity_idx" ON "permissions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_type_idx" ON "permissions" USING btree ("user_id","entity_type");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_permission_idx" ON "permissions" USING btree ("user_id","entity_type","permission_type");--> statement-breakpoint
CREATE INDEX "permissions_user_entity_idx" ON "permissions" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_unique_constraint" ON "permissions" USING btree ("user_id","entity_type","entity_id");