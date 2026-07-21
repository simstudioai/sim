ALTER TYPE "public"."usage_log_source" ADD VALUE 'eval';--> statement-breakpoint
CREATE TABLE "workflow_eval_criterion_run" (
	"id" text PRIMARY KEY NOT NULL,
	"test_run_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"phase" text NOT NULL,
	"verdict" text,
	"confidence" double precision,
	"reason" text,
	"requested_model" text NOT NULL,
	"provider_id" text,
	"response_model" text,
	"prompt_version" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost" numeric,
	"duration_ms" integer,
	"error_kind" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_eval_criterion_run_phase_check" CHECK ("workflow_eval_criterion_run"."phase" IN ('queued', 'running', 'completed', 'error')),
	CONSTRAINT "workflow_eval_criterion_run_ordinal_check" CHECK ("workflow_eval_criterion_run"."ordinal" BETWEEN 0 AND 11),
	CONSTRAINT "workflow_eval_criterion_run_verdict_confidence_check" CHECK (("workflow_eval_criterion_run"."verdict" IS NULL OR "workflow_eval_criterion_run"."verdict" IN ('pass', 'warning', 'fail')) AND ("workflow_eval_criterion_run"."confidence" IS NULL OR ("workflow_eval_criterion_run"."confidence" >= 0 AND "workflow_eval_criterion_run"."confidence" <= 1))),
	CONSTRAINT "workflow_eval_criterion_run_lifecycle_check" CHECK ((("workflow_eval_criterion_run"."phase" = 'queued' AND "workflow_eval_criterion_run"."verdict" IS NULL AND "workflow_eval_criterion_run"."confidence" IS NULL AND "workflow_eval_criterion_run"."reason" IS NULL AND "workflow_eval_criterion_run"."error_kind" IS NULL AND "workflow_eval_criterion_run"."error_code" IS NULL AND "workflow_eval_criterion_run"."error_message" IS NULL AND "workflow_eval_criterion_run"."started_at" IS NULL AND "workflow_eval_criterion_run"."completed_at" IS NULL) OR ("workflow_eval_criterion_run"."phase" = 'running' AND "workflow_eval_criterion_run"."verdict" IS NULL AND "workflow_eval_criterion_run"."confidence" IS NULL AND "workflow_eval_criterion_run"."reason" IS NULL AND "workflow_eval_criterion_run"."error_kind" IS NULL AND "workflow_eval_criterion_run"."error_code" IS NULL AND "workflow_eval_criterion_run"."error_message" IS NULL AND "workflow_eval_criterion_run"."started_at" IS NOT NULL AND "workflow_eval_criterion_run"."completed_at" IS NULL) OR ("workflow_eval_criterion_run"."phase" = 'completed' AND "workflow_eval_criterion_run"."verdict" IS NOT NULL AND "workflow_eval_criterion_run"."confidence" IS NOT NULL AND "workflow_eval_criterion_run"."reason" IS NOT NULL AND "workflow_eval_criterion_run"."error_kind" IS NULL AND "workflow_eval_criterion_run"."error_code" IS NULL AND "workflow_eval_criterion_run"."error_message" IS NULL AND "workflow_eval_criterion_run"."started_at" IS NOT NULL AND "workflow_eval_criterion_run"."completed_at" IS NOT NULL) OR ("workflow_eval_criterion_run"."phase" = 'error' AND "workflow_eval_criterion_run"."verdict" IS NULL AND "workflow_eval_criterion_run"."confidence" IS NULL AND "workflow_eval_criterion_run"."reason" IS NULL AND "workflow_eval_criterion_run"."error_kind" IS NOT NULL AND "workflow_eval_criterion_run"."error_code" IS NOT NULL AND "workflow_eval_criterion_run"."error_message" IS NOT NULL AND "workflow_eval_criterion_run"."started_at" IS NOT NULL AND "workflow_eval_criterion_run"."completed_at" IS NOT NULL))),
	CONSTRAINT "workflow_eval_criterion_run_metadata_check" CHECK (char_length("workflow_eval_criterion_run"."requested_model") BETWEEN 1 AND 200 AND char_length("workflow_eval_criterion_run"."prompt_version") BETWEEN 1 AND 128 AND ("workflow_eval_criterion_run"."provider_id" IS NULL OR char_length("workflow_eval_criterion_run"."provider_id") BETWEEN 1 AND 128) AND ("workflow_eval_criterion_run"."response_model" IS NULL OR char_length("workflow_eval_criterion_run"."response_model") BETWEEN 1 AND 200)),
	CONSTRAINT "workflow_eval_criterion_run_usage_check" CHECK (("workflow_eval_criterion_run"."input_tokens" IS NULL OR "workflow_eval_criterion_run"."input_tokens" >= 0) AND ("workflow_eval_criterion_run"."output_tokens" IS NULL OR "workflow_eval_criterion_run"."output_tokens" >= 0) AND ("workflow_eval_criterion_run"."total_tokens" IS NULL OR "workflow_eval_criterion_run"."total_tokens" >= 0) AND ("workflow_eval_criterion_run"."cost" IS NULL OR ("workflow_eval_criterion_run"."cost" >= 0 AND "workflow_eval_criterion_run"."cost" <> 'NaN'::numeric)) AND ("workflow_eval_criterion_run"."duration_ms" IS NULL OR "workflow_eval_criterion_run"."duration_ms" >= 0)),
	CONSTRAINT "workflow_eval_criterion_run_error_check" CHECK (("workflow_eval_criterion_run"."error_kind" IS NULL OR "workflow_eval_criterion_run"."error_kind" IN ('subject', 'evaluator', 'infrastructure')) AND ("workflow_eval_criterion_run"."error_code" IS NULL OR "workflow_eval_criterion_run"."error_code" ~ '^[a-z][a-z0-9_]{0,127}$') AND ("workflow_eval_criterion_run"."error_message" IS NULL OR char_length("workflow_eval_criterion_run"."error_message") BETWEEN 1 AND 20000) AND ("workflow_eval_criterion_run"."reason" IS NULL OR char_length("workflow_eval_criterion_run"."reason") BETWEEN 1 AND 4000))
);
--> statement-breakpoint
CREATE TABLE "workflow_eval_run" (
	"id" text PRIMARY KEY NOT NULL,
	"suite_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text NOT NULL,
	"definition_snapshot" jsonb NOT NULL,
	"suite_definition_revision" integer DEFAULT 1 NOT NULL,
	"scope" text DEFAULT 'suite' NOT NULL,
	"selected_test_id" text,
	"billing_attribution" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"total_count" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_kind" text,
	"error_code" text,
	"error_message" text,
	"triggered_by_user_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_eval_run_status_check" CHECK ("workflow_eval_run"."status" IN ('queued', 'running', 'completed', 'error', 'cancelled')),
	CONSTRAINT "workflow_eval_run_scope_check" CHECK (("workflow_eval_run"."scope" = 'suite' AND "workflow_eval_run"."selected_test_id" IS NULL) OR ("workflow_eval_run"."scope" = 'test' AND "workflow_eval_run"."selected_test_id" IS NOT NULL)),
	CONSTRAINT "workflow_eval_run_suite_definition_revision_check" CHECK ("workflow_eval_run"."suite_definition_revision" >= 1),
	CONSTRAINT "workflow_eval_run_counts_check" CHECK ("workflow_eval_run"."revision" >= 0 AND "workflow_eval_run"."total_count" BETWEEN 0 AND 1000 AND "workflow_eval_run"."completed_count" >= 0 AND "workflow_eval_run"."passed_count" >= 0 AND "workflow_eval_run"."warning_count" >= 0 AND "workflow_eval_run"."failed_count" >= 0 AND "workflow_eval_run"."error_count" >= 0 AND "workflow_eval_run"."completed_count" = "workflow_eval_run"."passed_count" + "workflow_eval_run"."warning_count" + "workflow_eval_run"."failed_count" + "workflow_eval_run"."error_count" AND "workflow_eval_run"."completed_count" <= "workflow_eval_run"."total_count"),
	CONSTRAINT "workflow_eval_run_terminal_counts_check" CHECK (("workflow_eval_run"."status" <> 'queued' OR "workflow_eval_run"."completed_count" = 0) AND ("workflow_eval_run"."status" <> 'completed' OR "workflow_eval_run"."completed_count" = "workflow_eval_run"."total_count")),
	CONSTRAINT "workflow_eval_run_completion_check" CHECK ((("workflow_eval_run"."status" IN ('queued', 'running') AND "workflow_eval_run"."completed_at" IS NULL) OR ("workflow_eval_run"."status" IN ('completed', 'error', 'cancelled') AND "workflow_eval_run"."completed_at" IS NOT NULL))),
	CONSTRAINT "workflow_eval_run_started_check" CHECK ("workflow_eval_run"."status" NOT IN ('running', 'completed') OR "workflow_eval_run"."started_at" IS NOT NULL),
	CONSTRAINT "workflow_eval_run_error_check" CHECK ((("workflow_eval_run"."status" = 'error' AND "workflow_eval_run"."error_kind" = 'infrastructure' AND "workflow_eval_run"."error_code" ~ '^[a-z][a-z0-9_]{0,127}$' AND char_length("workflow_eval_run"."error_message") BETWEEN 1 AND 20000) OR ("workflow_eval_run"."status" <> 'error' AND "workflow_eval_run"."error_kind" IS NULL AND "workflow_eval_run"."error_code" IS NULL AND "workflow_eval_run"."error_message" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "workflow_eval_run_target" (
	"run_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"is_subject" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_eval_run_target_run_id_workflow_id_pk" PRIMARY KEY("run_id","workflow_id"),
	CONSTRAINT "workflow_eval_run_target_state_hash_check" CHECK (char_length("workflow_eval_run_target"."state_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "workflow_eval_suite" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"name" text NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"definition_revision" integer DEFAULT 1 NOT NULL,
	"tests" jsonb NOT NULL,
	"archived_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_eval_suite_definition_version_check" CHECK ("workflow_eval_suite"."definition_version" = 1),
	CONSTRAINT "workflow_eval_suite_definition_revision_check" CHECK ("workflow_eval_suite"."definition_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workflow_eval_test_run" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"test_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"evaluator_type" text NOT NULL,
	"phase" text NOT NULL,
	"outcome" text,
	"score" double precision,
	"reason" text,
	"error_block_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_kind" text,
	"error_code" text,
	"error_message" text,
	"subject_execution_id" text NOT NULL,
	"judge_execution_id" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_eval_test_run_evaluator_type_check" CHECK ("workflow_eval_test_run"."evaluator_type" IN ('code', 'agent', 'workflow')),
	CONSTRAINT "workflow_eval_test_run_phase_check" CHECK ("workflow_eval_test_run"."phase" IN ('queued', 'running_subject', 'running_evaluator', 'completed', 'error')),
	CONSTRAINT "workflow_eval_test_run_ordinal_check" CHECK ("workflow_eval_test_run"."ordinal" BETWEEN 0 AND 999),
	CONSTRAINT "workflow_eval_test_run_score_outcome_check" CHECK ((("workflow_eval_test_run"."outcome" = 'pass' AND "workflow_eval_test_run"."score" >= 8 AND "workflow_eval_test_run"."score" <= 10) OR ("workflow_eval_test_run"."outcome" = 'warning' AND "workflow_eval_test_run"."score" >= 5 AND "workflow_eval_test_run"."score" < 8) OR ("workflow_eval_test_run"."outcome" = 'fail' AND "workflow_eval_test_run"."score" >= 0 AND "workflow_eval_test_run"."score" < 5) OR ("workflow_eval_test_run"."outcome" IS NULL AND "workflow_eval_test_run"."score" IS NULL))),
	CONSTRAINT "workflow_eval_test_run_lifecycle_check" CHECK ((("workflow_eval_test_run"."phase" = 'queued' AND "workflow_eval_test_run"."outcome" IS NULL AND "workflow_eval_test_run"."score" IS NULL AND "workflow_eval_test_run"."reason" IS NULL AND "workflow_eval_test_run"."error_kind" IS NULL AND "workflow_eval_test_run"."error_code" IS NULL AND "workflow_eval_test_run"."error_message" IS NULL AND "workflow_eval_test_run"."started_at" IS NULL AND "workflow_eval_test_run"."completed_at" IS NULL) OR ("workflow_eval_test_run"."phase" IN ('running_subject', 'running_evaluator') AND "workflow_eval_test_run"."outcome" IS NULL AND "workflow_eval_test_run"."score" IS NULL AND "workflow_eval_test_run"."reason" IS NULL AND "workflow_eval_test_run"."error_kind" IS NULL AND "workflow_eval_test_run"."error_code" IS NULL AND "workflow_eval_test_run"."error_message" IS NULL AND "workflow_eval_test_run"."started_at" IS NOT NULL AND "workflow_eval_test_run"."completed_at" IS NULL) OR ("workflow_eval_test_run"."phase" = 'completed' AND "workflow_eval_test_run"."outcome" IS NOT NULL AND "workflow_eval_test_run"."score" IS NOT NULL AND "workflow_eval_test_run"."error_kind" IS NULL AND "workflow_eval_test_run"."error_code" IS NULL AND "workflow_eval_test_run"."error_message" IS NULL AND "workflow_eval_test_run"."started_at" IS NOT NULL AND "workflow_eval_test_run"."completed_at" IS NOT NULL) OR ("workflow_eval_test_run"."phase" = 'error' AND "workflow_eval_test_run"."outcome" IS NULL AND "workflow_eval_test_run"."score" IS NULL AND "workflow_eval_test_run"."reason" IS NULL AND "workflow_eval_test_run"."error_kind" IS NOT NULL AND "workflow_eval_test_run"."error_code" IS NOT NULL AND "workflow_eval_test_run"."error_message" IS NOT NULL AND "workflow_eval_test_run"."started_at" IS NOT NULL AND "workflow_eval_test_run"."completed_at" IS NOT NULL))),
	CONSTRAINT "workflow_eval_test_run_error_check" CHECK (("workflow_eval_test_run"."error_kind" IS NULL OR "workflow_eval_test_run"."error_kind" IN ('subject', 'evaluator', 'infrastructure')) AND ("workflow_eval_test_run"."error_code" IS NULL OR "workflow_eval_test_run"."error_code" ~ '^[a-z][a-z0-9_]{0,127}$') AND ("workflow_eval_test_run"."error_message" IS NULL OR char_length("workflow_eval_test_run"."error_message") BETWEEN 1 AND 20000) AND ("workflow_eval_test_run"."reason" IS NULL OR char_length("workflow_eval_test_run"."reason") BETWEEN 1 AND 20000)),
	CONSTRAINT "workflow_eval_test_run_code_score_check" CHECK ("workflow_eval_test_run"."evaluator_type" <> 'code' OR "workflow_eval_test_run"."phase" <> 'completed' OR (("workflow_eval_test_run"."outcome" = 'pass' AND "workflow_eval_test_run"."score" = 10) OR ("workflow_eval_test_run"."outcome" = 'fail' AND "workflow_eval_test_run"."score" = 0))),
	CONSTRAINT "workflow_eval_test_run_judge_execution_check" CHECK ((("workflow_eval_test_run"."evaluator_type" = 'workflow' AND "workflow_eval_test_run"."judge_execution_id" IS NOT NULL) OR ("workflow_eval_test_run"."evaluator_type" <> 'workflow' AND "workflow_eval_test_run"."judge_execution_id" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "workflow_eval_criterion_run" ADD CONSTRAINT "workflow_eval_criterion_run_test_run_id_workflow_eval_test_run_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."workflow_eval_test_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_run" ADD CONSTRAINT "workflow_eval_run_suite_id_workflow_eval_suite_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."workflow_eval_suite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_run" ADD CONSTRAINT "workflow_eval_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_run" ADD CONSTRAINT "workflow_eval_run_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_run_target" ADD CONSTRAINT "workflow_eval_run_target_run_id_workflow_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_eval_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_run_target" ADD CONSTRAINT "workflow_eval_run_target_snapshot_id_workflow_execution_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."workflow_execution_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_suite" ADD CONSTRAINT "workflow_eval_suite_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_suite" ADD CONSTRAINT "workflow_eval_suite_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_eval_test_run" ADD CONSTRAINT "workflow_eval_test_run_run_id_workflow_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_eval_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_criterion_run_test_criterion_unique" ON "workflow_eval_criterion_run" USING btree ("test_run_id","criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_criterion_run_test_ordinal_unique" ON "workflow_eval_criterion_run" USING btree ("test_run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_run_active_suite_unique" ON "workflow_eval_run" USING btree ("suite_id") WHERE "workflow_eval_run"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "workflow_eval_run_suite_created_idx" ON "workflow_eval_run" USING btree ("suite_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "workflow_eval_run_workspace_created_idx" ON "workflow_eval_run" USING btree ("workspace_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_run_target_run_snapshot_unique" ON "workflow_eval_run_target" USING btree ("run_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_run_target_subject_unique" ON "workflow_eval_run_target" USING btree ("run_id") WHERE "workflow_eval_run_target"."is_subject";--> statement-breakpoint
CREATE INDEX "workflow_eval_run_target_snapshot_idx" ON "workflow_eval_run_target" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_suite_workflow_name_unique" ON "workflow_eval_suite" USING btree ("workflow_id","name");--> statement-breakpoint
CREATE INDEX "workflow_eval_suite_workflow_created_idx" ON "workflow_eval_suite" USING btree ("workflow_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_test_run_run_test_unique" ON "workflow_eval_test_run" USING btree ("run_id","test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_eval_test_run_run_ordinal_unique" ON "workflow_eval_test_run" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "workflow_eval_test_run_subject_execution_idx" ON "workflow_eval_test_run" USING btree ("subject_execution_id");--> statement-breakpoint
CREATE INDEX "workflow_eval_test_run_judge_execution_idx" ON "workflow_eval_test_run" USING btree ("judge_execution_id");