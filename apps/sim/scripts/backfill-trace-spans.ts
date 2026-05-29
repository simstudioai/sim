#!/usr/bin/env bun

/**
 * One-shot backfill for the trace-spans-to-S3 + usage_log-cost migration.
 *
 * Two independent, idempotent, resumable passes:
 *
 *   1. Cost projections (cheap, no object storage): populates
 *      `workflow_execution_logs.cost_total` and `models_used` from the existing
 *      (reconciling) `cost` jsonb so the logs list filter/sort/model-filter is
 *      uniform across old and new rows. Only touches rows where `cost_total` is
 *      still null. Run this before the `cost` column is dropped in a follow-up PR.
 *
 *   2. Trace storage (heavier): externalizes inline heavy `execution_data`
 *      (traceSpans, finalOutput, workflowInput, ...) into the execution-context
 *      large-value store, matching the completion path (cost-stripped spans,
 *      trace pointer + markers, owner/dependency + execution_log reference
 *      registration). Skips running rows and rows already carrying the pointer.
 *
 * Both passes are safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/sim/scripts/backfill-trace-spans.ts [flags]
 *
 * Flags:
 *   --projections-only   Run only pass 1 (cost_total / models_used).
 *   --trace-only         Run only pass 2 (externalize execution_data).
 *   --max-batches=<n>    Cap the number of batches per pass (default: unbounded).
 *
 * Examples:
 *   bun apps/sim/scripts/backfill-trace-spans.ts --projections-only
 *   bun apps/sim/scripts/backfill-trace-spans.ts --trace-only --max-batches=10
 *   bun apps/sim/scripts/backfill-trace-spans.ts
 */

import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { toError } from '@sim/utils/errors'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import {
  collectLargeValueReferenceKeys,
  replaceLargeValueReferenceKeysWithClient,
} from '@/lib/execution/payloads/large-value-metadata'
import {
  externalizeExecutionData,
  stripSpanCosts,
  TRACE_STORE_REF_KEY,
} from '@/lib/logs/execution/trace-store'

const PROJECTION_BATCH_SIZE = 1000
const TRACE_BATCH_SIZE = 100

/**
 * Recursively counts trace spans (matching the completion path). Legacy rows
 * predate the inline hasTraceSpans/traceSpanCount markers, so we derive them
 * before externalizing — otherwise a post-expiry degraded read can't report
 * "trace data expired (N spans)".
 */
function countTraceSpans(spans: unknown): number {
  if (!Array.isArray(spans)) return 0
  return spans.reduce(
    (count: number, span) =>
      count + 1 + countTraceSpans((span as { children?: unknown } | null)?.children),
    0
  )
}

interface Options {
  projections: boolean
  trace: boolean
  maxBatches: number
}

function parseArgs(argv: string[]): Options {
  const projectionsOnly = argv.includes('--projections-only')
  const traceOnly = argv.includes('--trace-only')
  const maxBatchesArg = argv.find((a) => a.startsWith('--max-batches='))
  const maxBatches = maxBatchesArg
    ? Number.parseInt(maxBatchesArg.slice('--max-batches='.length), 10)
    : Number.POSITIVE_INFINITY

  if (Number.isNaN(maxBatches) || maxBatches <= 0) {
    throw new Error('--max-batches must be a positive integer')
  }

  return {
    projections: !traceOnly,
    trace: !projectionsOnly,
    maxBatches,
  }
}

/** Pass 1: backfill cost_total + models_used from the cost jsonb. */
async function backfillCostProjections(maxBatches: number): Promise<number> {
  let updated = 0

  for (let batch = 0; batch < maxBatches; batch++) {
    // Candidate set is restricted to rows we can actually project (numeric
    // `total` present). Every updated row leaves the set (cost_total becomes
    // non-null); rows without a numeric total never match — so the set strictly
    // drains and the loop terminates instead of re-selecting unprojectable rows.
    const result = await db.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT id FROM ${workflowExecutionLogs}
        WHERE cost_total IS NULL
          AND cost ? 'total'
          AND (cost->>'total') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        LIMIT ${PROJECTION_BATCH_SIZE}
      )
      UPDATE ${workflowExecutionLogs} AS wel
      SET
        cost_total = NULLIF(wel.cost->>'total', '')::numeric,
        models_used = CASE
          WHEN jsonb_typeof(wel.cost->'models') = 'object'
          THEN ARRAY(SELECT jsonb_object_keys(wel.cost->'models'))
          ELSE wel.models_used
        END
      FROM candidates
      WHERE wel.id = candidates.id
      RETURNING wel.id
    `)

    const rowCount = result.length
    updated += rowCount
    console.log(`  [projections] batch ${batch + 1}: updated ${rowCount} (total ${updated})`)
    if (rowCount < PROJECTION_BATCH_SIZE) break
  }

  return updated
}

/** Pass 2: externalize inline heavy execution_data into the large-value store. */
async function backfillTraceStorage(
  maxBatches: number
): Promise<{ migrated: number; failed: number }> {
  let migrated = 0
  let failed = 0
  // Keyset cursor by id: every row is visited at most once per run, so rows that
  // can't be externalized (storage error, oversized) aren't re-selected into an
  // infinite loop. A fresh re-run (cursor reset) retries any that failed.
  let lastId = ''

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workspaceId: workflowExecutionLogs.workspaceId,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          sql`${workflowExecutionLogs.endedAt} IS NOT NULL`,
          // Skip deleted-workflow rows: externalization requires a workflowId.
          sql`${workflowExecutionLogs.workflowId} IS NOT NULL`,
          sql`${workflowExecutionLogs.executionData} ? 'traceSpans'`,
          sql`NOT (${workflowExecutionLogs.executionData} ? ${TRACE_STORE_REF_KEY})`,
          lastId ? gt(workflowExecutionLogs.id, lastId) : undefined
        )
      )
      .orderBy(asc(workflowExecutionLogs.id))
      .limit(TRACE_BATCH_SIZE)

    if (rows.length === 0) break

    for (const row of rows) {
      try {
        const executionData = (row.executionData ?? {}) as Record<string, unknown>
        // Derive the inline markers legacy rows lack so externalizeExecutionData
        // carries them onto the slim row (they survive object expiry).
        const traceSpanCount = countTraceSpans(executionData.traceSpans)
        executionData.hasTraceSpans = traceSpanCount > 0
        executionData.traceSpanCount = traceSpanCount
        stripSpanCosts(executionData.traceSpans)
        const slim = await externalizeExecutionData(executionData, {
          workspaceId: row.workspaceId,
          workflowId: row.workflowId,
          executionId: row.executionId,
        })

        if (!(TRACE_STORE_REF_KEY in slim)) {
          failed++
          continue
        }

        await db.transaction(async (tx) => {
          await tx
            .update(workflowExecutionLogs)
            .set({ executionData: slim })
            .where(eq(workflowExecutionLogs.id, row.id))

          await replaceLargeValueReferenceKeysWithClient(
            tx,
            {
              workspaceId: row.workspaceId,
              workflowId: row.workflowId,
              executionId: row.executionId,
              source: 'execution_log',
            },
            collectLargeValueReferenceKeys(slim)
          )
        })

        migrated++
      } catch (error) {
        failed++
        console.error(`  [trace] row ${row.id} failed: ${toError(error).message}`)
      }
    }

    // Advance the cursor past this batch so failed rows aren't re-selected.
    lastId = rows[rows.length - 1].id

    console.log(`  [trace] batch ${batch + 1}: migrated ${migrated}, failed ${failed}`)
  }

  return { migrated, failed }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()

  if (options.projections) {
    console.log('Backfilling cost projections (cost_total / models_used)…')
    const updated = await backfillCostProjections(options.maxBatches)
    console.log(`Projections done: ${updated} rows updated.`)
  }

  if (options.trace) {
    console.log('Backfilling trace storage (externalizing execution_data)…')
    const { migrated, failed } = await backfillTraceStorage(options.maxBatches)
    console.log(`Trace storage done: ${migrated} migrated, ${failed} skipped/failed.`)
  }

  console.log(`Backfill complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`)
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
