CREATE TABLE "workload_identity_pending_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workload_identity_pending_subject" ADD CONSTRAINT "workload_identity_pending_subject_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_identity_pending_subject" ADD CONSTRAINT "workload_identity_pending_subject_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workload_identity_pending_subject_subject_unique" ON "workload_identity_pending_subject" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "workload_identity_pending_subject_issuer_idx" ON "workload_identity_pending_subject" USING btree ("workspace_id","user_id","provider","created_at");--> statement-breakpoint
CREATE INDEX "workload_identity_pending_subject_user_id_idx" ON "workload_identity_pending_subject" USING btree ("user_id");