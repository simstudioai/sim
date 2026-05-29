#!/usr/bin/env bun

/**
 * One-shot, idempotent, resumable backfill that externalizes inline heavy
 * `execution_data` (traceSpans, finalOutput, workflowInput, ...) into the
 * execution-context large-value store, matching the completion path (cost-stripped
 * spans, trace pointer + markers, owner/dependency + execution_log reference
 * registration). Skips running rows and rows already carrying the pointer.
 *
 * Requires object storage to be configured; self-hosted deployments without it
 * keep `execution_data` inline (reads resolve inline transparently) and can skip
 * this script entirely.
 *
 * NOTE: the companion `cost_total` / `models_used` backfill is done in SQL by
 * migration 0220 (batched, idempotent), so it runs for everyone — including
 * self-hosted — and is intentionally NOT part of this script.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/sim/scripts/backfill-trace-spans.ts [--max-batches=<n>]
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
  maxBatches: number
}

function parseArgs(argv: string[]): Options {
  const maxBatchesArg = argv.find((a) => a.startsWith('--max-batches='))
  const maxBatches = maxBatchesArg
    ? Number.parseInt(maxBatchesArg.slice('--max-batches='.length), 10)
    : Number.POSITIVE_INFINITY

  if (Number.isNaN(maxBatches) || maxBatches <= 0) {
    throw new Error('--max-batches must be a positive integer')
  }

  return { maxBatches }
}

/** Externalize inline heavy execution_data into the large-value store. */
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
        // workspace_files.user_id (NOT NULL) needs the execution owner; legacy
        // rows carry it under executionData.environment.userId. Rows without an
        // owner can't be externalized — count them as failed and skip.
        const environment = executionData.environment as { userId?: string } | undefined
        const ownerUserId = environment?.userId
        if (!ownerUserId) {
          failed++
          continue
        }
        const slim = await externalizeExecutionData(executionData, {
          workspaceId: row.workspaceId,
          workflowId: row.workflowId,
          executionId: row.executionId,
          userId: ownerUserId,
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

  console.log('Backfilling trace storage (externalizing execution_data)…')
  const { migrated, failed } = await backfillTraceStorage(options.maxBatches)
  console.log(`Trace storage done: ${migrated} migrated, ${failed} skipped/failed.`)

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
