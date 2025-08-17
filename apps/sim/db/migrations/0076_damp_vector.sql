-- One-shot data migration to create/populate execution_data & cost, then drop legacy columns
-- Safe on reruns and across differing prior schemas

-- 1) Ensure execution_data exists (prefer rename if only metadata exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workflow_execution_logs' AND column_name = 'metadata'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workflow_execution_logs' AND column_name = 'execution_data'
  ) THEN
    EXECUTE 'ALTER TABLE workflow_execution_logs RENAME COLUMN metadata TO execution_data';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "workflow_execution_logs"
  ADD COLUMN IF NOT EXISTS "execution_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "cost" jsonb;--> statement-breakpoint

-- 2) Backfill top-level cost from legacy numeric columns, tokenBreakdown/models, and traceSpans aggregates
WITH RECURSIVE spans AS (
  SELECT l.id, s.span
  FROM workflow_execution_logs l
  LEFT JOIN LATERAL jsonb_array_elements(
    COALESCE(
      CASE
        WHEN jsonb_typeof(l.execution_data->'traceSpans') = 'array' THEN l.execution_data->'traceSpans'
        ELSE '[]'::jsonb
      END
    )
  ) s(span) ON true
  UNION ALL
  SELECT spans.id, c.span
  FROM spans
  JOIN LATERAL jsonb_array_elements(COALESCE(spans.span->'children','[]'::jsonb)) c(span) ON true
),
agg AS (
  SELECT id,
         SUM(COALESCE((span->'cost'->>'input')::numeric,0)) AS agg_input,
         SUM(COALESCE((span->'cost'->>'output')::numeric,0)) AS agg_output,
         SUM(COALESCE((span->'cost'->>'total')::numeric,0)) AS agg_total,
         SUM(COALESCE((span->'cost'->'tokens'->>'prompt')::numeric, COALESCE((span->'tokens'->>'prompt')::numeric,0))) AS agg_tokens_prompt,
         SUM(COALESCE((span->'cost'->'tokens'->>'completion')::numeric, COALESCE((span->'tokens'->>'completion')::numeric,0))) AS agg_tokens_completion,
         SUM(COALESCE((span->'cost'->'tokens'->>'total')::numeric, COALESCE((span->'tokens'->>'total')::numeric,0))) AS agg_tokens_total
  FROM spans
  GROUP BY id
),
model_rows AS (
  SELECT id,
         (span->'cost'->>'model') AS model,
         COALESCE((span->'cost'->>'input')::numeric,0) AS input,
         COALESCE((span->'cost'->>'output')::numeric,0) AS output,
         COALESCE((span->'cost'->>'total')::numeric,0) AS total,
         COALESCE((span->'cost'->'tokens'->>'prompt')::numeric,0) AS tokens_prompt,
         COALESCE((span->'cost'->'tokens'->>'completion')::numeric,0) AS tokens_completion,
         COALESCE((span->'cost'->'tokens'->>'total')::numeric,0) AS tokens_total
  FROM spans
  WHERE span ? 'cost' AND (span->'cost'->>'model') IS NOT NULL
),
model_sums AS (
  SELECT id,
         model,
         SUM(input) AS input,
         SUM(output) AS output,
         SUM(total) AS total,
         SUM(tokens_prompt) AS tokens_prompt,
         SUM(tokens_completion) AS tokens_completion,
         SUM(tokens_total) AS tokens_total
  FROM model_rows
  GROUP BY id, model
),
models AS (
  SELECT id,
         jsonb_object_agg(model, jsonb_build_object(
           'input', input,
           'output', output,
           'total', total,
           'tokens', jsonb_build_object(
             'prompt', tokens_prompt,
             'completion', tokens_completion,
             'total', tokens_total
           )
         )) AS models
  FROM model_sums
  GROUP BY id
),
tb AS (
  SELECT l.id,
         NULLIF((l.execution_data->'tokenBreakdown'->>'prompt')::numeric, 0) AS prompt,
         NULLIF((l.execution_data->'tokenBreakdown'->>'completion')::numeric, 0) AS completion
  FROM workflow_execution_logs l
)
UPDATE workflow_execution_logs AS l
SET cost = jsonb_strip_nulls(
  jsonb_build_object(
    'total', COALESCE(l.total_cost, NULLIF(agg.agg_total,0)),
    'input', COALESCE(l.total_input_cost, NULLIF(agg.agg_input,0)),
    'output', COALESCE(l.total_output_cost, NULLIF(agg.agg_output,0)),
    'tokens', CASE
      WHEN l.total_tokens IS NOT NULL OR tb.prompt IS NOT NULL OR tb.completion IS NOT NULL OR NULLIF(agg.agg_tokens_total,0) IS NOT NULL THEN
        jsonb_strip_nulls(
          jsonb_build_object(
            'total', COALESCE(l.total_tokens, NULLIF(agg.agg_tokens_total,0)),
            'prompt', COALESCE(tb.prompt, NULLIF(agg.agg_tokens_prompt,0)),
            'completion', COALESCE(tb.completion, NULLIF(agg.agg_tokens_completion,0))
          )
        )
      ELSE NULL
    END,
    'models', models.models
  )
)
FROM agg
LEFT JOIN models ON models.id = agg.id
LEFT JOIN tb ON tb.id = agg.id
WHERE l.id = agg.id;--> statement-breakpoint

-- 3) Drop legacy columns now that backfill is complete
ALTER TABLE "workflow_execution_logs"
  DROP COLUMN IF EXISTS "message",
  DROP COLUMN IF EXISTS "block_count",
  DROP COLUMN IF EXISTS "success_count",
  DROP COLUMN IF EXISTS "error_count",
  DROP COLUMN IF EXISTS "skipped_count",
  DROP COLUMN IF EXISTS "total_cost",
  DROP COLUMN IF EXISTS "total_input_cost",
  DROP COLUMN IF EXISTS "total_output_cost",
  DROP COLUMN IF EXISTS "total_tokens",
  DROP COLUMN IF EXISTS "metadata";