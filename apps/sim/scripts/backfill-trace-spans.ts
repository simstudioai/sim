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
 *   bun apps/sim/scripts/backfill-trace-spans.ts --check-only
 *   bun apps/sim/scripts/backfill-trace-spans.ts --concurrency=4 [--max-batches=<n>]
 *   bun apps/sim/scripts/backfill-trace-spans.ts --concurrency=50
 *   bun apps/sim/scripts/backfill-trace-spans.ts --concurrency=50 --order=newest --before=<ISO-timestamp>
 *   bun apps/sim/scripts/backfill-trace-spans.ts --concurrency=50 --cursor=<checkpoint-token>
 *   bun apps/sim/scripts/backfill-trace-spans.ts --concurrency=10 --skip-oversized --cursor=<checkpoint-token>
 *   bun apps/sim/scripts/backfill-trace-spans.ts --concurrency=200 --max-in-flight-mib=512 --cursor=<checkpoint-token>
 *
 * Uses the configured database URLs and object storage. Stops on the first
 * failure after draining active workers; reruns skip committed rows.
 * Reports migrated rows, throughput, and elapsed time every five seconds.
 * Concurrency accepts 1–512 workers; it does not set a rows-per-second target.
 * Payload reads share a serialized-byte budget (512 MiB by default). Parsed
 * objects, serialization copies, and the shared cache use additional memory.
 * Reports RSS and cumulative average timings per stage without counting rows.
 * SIGINT/SIGTERM stop scheduling and drain active writes. A partial page never
 * advances the checkpoint; resuming rechecks its already-committed rows.
 * Scans oldest first by started_at, with id breaking ties. --before is an
 * exclusive start-time cutoff (defaults to startup). Each completed page logs
 * a cursor that preserves the cutoff and order for restart. --max-batches
 * limits pages examined, including pages with no eligible payloads.
 * --skip-oversized explicitly leaves payloads above the durable storage limit
 * inline, logs each skipped ID and size, and reports their count. Completed
 * pages advance past these rows; retry them from an earlier checkpoint after
 * addressing their size. All other failures still stop the run.
 */

import { db, dbFor } from '@sim/db'
import {
  executionLargeValueDependencies,
  executionLargeValueReferences,
  executionLargeValues,
  workflow,
  workflowExecutionLogs,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import { formatDuration } from '@sim/utils/formatting'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  collectLargeValueReferenceKeys,
  replaceLargeValueReferenceKeysWithClient,
} from '@/lib/execution/payloads/large-value-metadata'
import { MAX_DURABLE_LARGE_VALUE_BYTES } from '@/lib/execution/payloads/limits'
import {
  externalizeExecutionData,
  stripSpanCosts,
  TRACE_STORE_REF_KEY,
} from '@/lib/logs/execution/trace-store'

const TRACE_BATCH_SIZE = 100
const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 512
const MIB = 1024 * 1024
const DEFAULT_MAX_IN_FLIGHT_MIB = 512
const PROGRESS_INTERVAL_MS = 5_000
const logger = createLogger('BackfillTraceSpans', { logLevel: 'INFO' })
const orderSchema = z.enum(['oldest', 'newest'])
const cutoffSchema = z.iso.datetime({ offset: true })
const cursorSchema = z.object({
  version: z.literal(1),
  order: orderSchema,
  before: cutoffSchema,
  startedAt: z.iso.datetime({ precision: 6 }),
  id: z.string().min(1).max(512),
})
type BackfillCursor = z.infer<typeof cursorSchema>

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
  concurrency: number
  maxInFlightMiB: number
  checkOnly: boolean
  skipOversized: boolean
  order: z.infer<typeof orderSchema>
  before: string
  cursor?: BackfillCursor
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    maxBatches: Number.POSITIVE_INFINITY,
    concurrency: DEFAULT_CONCURRENCY,
    maxInFlightMiB: DEFAULT_MAX_IN_FLIGHT_MIB,
    checkOnly: false,
    skipOversized: false,
    order: 'oldest',
    before: new Date().toISOString(),
  }
  let explicitOrder = false
  let explicitBefore = false
  for (const arg of argv) {
    if (arg === '--check-only') {
      options.checkOnly = true
      continue
    }
    if (arg === '--skip-oversized') {
      options.skipOversized = true
      continue
    }
    const [name, value] = arg.split('=')
    if (name === '--order' || name === '--before' || name === '--cursor') {
      if (!value || arg.split('=').length !== 2) {
        throw new Error(`${name} requires a value`)
      }
      if (name === '--order') {
        options.order = orderSchema.parse(value)
        explicitOrder = true
      } else if (name === '--before') {
        options.before = cutoffSchema.parse(value)
        explicitBefore = true
      } else {
        try {
          options.cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
          )
        } catch (error) {
          throw new Error('Invalid --cursor: use a checkpoint token printed by the backfill', {
            cause: error,
          })
        }
      }
      continue
    }
    if (name !== '--max-batches' && name !== '--concurrency' && name !== '--max-in-flight-mib') {
      throw new Error(`Unknown argument: ${arg}`)
    }
    const parsed = Number(value)
    if (
      !/^\d+$/.test(value ?? '') ||
      !Number.isSafeInteger(parsed) ||
      parsed <= 0 ||
      arg.split('=').length !== 2
    ) {
      throw new Error(`${name} must be a positive integer`)
    }
    if (name === '--max-batches') options.maxBatches = parsed
    else if (name === '--max-in-flight-mib') options.maxInFlightMiB = parsed
    else options.concurrency = parsed
  }
  if (options.concurrency > MAX_CONCURRENCY) {
    throw new Error(`--concurrency must be between 1 and ${MAX_CONCURRENCY}`)
  }
  if (
    options.maxInFlightMiB < MAX_DURABLE_LARGE_VALUE_BYTES / MIB ||
    options.maxInFlightMiB > 4096
  ) {
    throw new Error('--max-in-flight-mib must be between 64 and 4096')
  }
  if (options.cursor) {
    if (explicitOrder && options.order !== options.cursor.order) {
      throw new Error('--order must match the checkpoint cursor')
    }
    if (explicitBefore && options.before !== options.cursor.before) {
      throw new Error('--before must match the checkpoint cursor')
    }
    options.order = options.cursor.order
    options.before = options.cursor.before
  }
  return options
}

/** Validates the metadata schema and SELECT permissions without reading payloads or writing. */
export async function checkDatabase(): Promise<void> {
  await db.select().from(workspaceFiles).limit(0)
  const execDb = dbFor('exec')
  await execDb.select().from(executionLargeValueReferences).limit(0)
  await execDb.select().from(executionLargeValues).limit(0)
  await execDb.select().from(executionLargeValueDependencies).limit(0)
  await execDb
    .select({
      id: workflowExecutionLogs.id,
      workspaceId: workflowExecutionLogs.workspaceId,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      executionData: workflowExecutionLogs.executionData,
      endedAt: workflowExecutionLogs.endedAt,
      startedAt: workflowExecutionLogs.startedAt,
      workflowOwnerUserId: workflow.userId,
    })
    .from(workflowExecutionLogs)
    .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .limit(0)
}

interface WorkerOptions<T> {
  signal?: AbortSignal
  byteBudget?: { maxBytes: number; sizeOf: (row: T) => number }
}

/** Bounds active payload bytes and workers; drains writes on failure or shutdown. */
export async function runBackfillWorkers<T>(
  rows: T[],
  concurrency: number,
  processRow: (row: T) => Promise<void>,
  { signal, byteBudget }: WorkerOptions<T> = {}
): Promise<number> {
  let completed = 0
  let activeBytes = 0
  let failure: Error | undefined
  const active = new Set<Promise<void>>()
  for (const row of rows) {
    const bytes = byteBudget ? byteBudget.sizeOf(row) : 0
    if (!Number.isSafeInteger(bytes) || bytes < 0 || (byteBudget && bytes > byteBudget.maxBytes)) {
      failure = new Error(
        'Candidate payload exceeds the backfill byte budget or has an invalid size'
      )
      break
    }
    while (
      active.size >= concurrency ||
      (byteBudget && activeBytes + bytes > byteBudget.maxBytes)
    ) {
      await Promise.race(active)
    }
    if (failure || signal?.aborted) break
    activeBytes += bytes
    const task = Promise.resolve()
      .then(async () => {
        await processRow(row)
        completed++
      })
      .catch((error) => {
        failure ??= toError(error)
      })
      .finally(() => {
        activeBytes -= bytes
        active.delete(task)
      })
    active.add(task)
  }
  await Promise.all(active)
  if (failure) throw failure
  return completed
}

/** Externalize inline heavy execution_data into the large-value store. */
export async function backfillTraceStorage(
  options: Options,
  signal?: AbortSignal
): Promise<{ migrated: number; skippedOversized: number }> {
  await checkDatabase()
  logger.info('Database schema and read checks passed')
  if (options.checkOnly) return { migrated: 0, skippedOversized: 0 }

  const execDb = dbFor('exec')
  let migrated = 0
  let skipped = 0
  let skippedOversized = 0
  let cursor = options.cursor
  const direction = options.order === 'oldest' ? asc : desc
  const pending = and(
    sql`${workflowExecutionLogs.endedAt} IS NOT NULL`,
    sql`${workflowExecutionLogs.workflowId} IS NOT NULL`,
    sql`${workflowExecutionLogs.executionData} ? 'traceSpans'`,
    sql`NOT (${workflowExecutionLogs.executionData} ? ${TRACE_STORE_REF_KEY})`
  )
  const startedAt = Date.now()
  const timings = {
    scan: { calls: 0, totalMs: 0 },
    size: { calls: 0, totalMs: 0 },
    read: { calls: 0, totalMs: 0 },
    externalize: { calls: 0, totalMs: 0 },
    commit: { calls: 0, totalMs: 0 },
  }
  const measure = async <T>(stage: keyof typeof timings, operation: () => PromiseLike<T>) => {
    const start = performance.now()
    try {
      return await operation()
    } finally {
      timings[stage].calls++
      timings[stage].totalMs += performance.now() - start
    }
  }
  const reportCheckpoint = () => {
    if (!cursor) return
    logger.info('Backfill checkpoint', {
      startedAt: cursor.startedAt,
      id: cursor.id,
      cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url'),
    })
  }
  logger.info('Scanning execution logs', { order: options.order, before: options.before })
  reportCheckpoint()
  const reportProgress = () => {
    const elapsedMs = Date.now() - startedAt
    const rowsPerSecond = elapsedMs > 0 ? migrated / (elapsedMs / 1000) : 0
    logger.info(
      `Progress: migrated ${migrated} | skipped ${skipped} (oversized ${skippedOversized}) | ${rowsPerSecond.toFixed(1)} rows/s | elapsed ${formatDuration(elapsedMs)}`,
      {
        rssMiB: Math.round(process.memoryUsage().rss / MIB),
        stages: Object.fromEntries(
          Object.entries(timings).map(([stage, { calls, totalMs }]) => [
            stage,
            { calls, averageMs: calls ? Math.round(totalMs / calls) : 0 },
          ])
        ),
      }
    )
  }
  reportProgress()
  const progressTimer = setInterval(reportProgress, PROGRESS_INTERVAL_MS)
  progressTimer.unref()

  try {
    for (let batch = 0; batch < options.maxBatches; batch++) {
      if (signal?.aborted) break
      /**
       * Seek by indexed time before checking JSON or joining workflows. Limiting
       * eligible rows here can scan the entire backlog to fill one page.
       * Preserve microseconds as text: a JS Date would lose cursor precision.
       */
      const cursorPredicate = cursor
        ? options.order === 'oldest'
          ? and(
              sql`${workflowExecutionLogs.startedAt} >= ${cursor.startedAt}::timestamp`,
              sql`(${workflowExecutionLogs.startedAt}, ${workflowExecutionLogs.id}) > (${cursor.startedAt}::timestamp, ${cursor.id})`
            )
          : and(
              sql`${workflowExecutionLogs.startedAt} <= ${cursor.startedAt}::timestamp`,
              sql`(${workflowExecutionLogs.startedAt}, ${workflowExecutionLogs.id}) < (${cursor.startedAt}::timestamp, ${cursor.id})`
            )
        : undefined
      const rows = await measure('scan', () =>
        execDb
          .select({
            id: workflowExecutionLogs.id,
            startedAt: sql<string>`to_char(${workflowExecutionLogs.startedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          })
          .from(workflowExecutionLogs)
          .where(
            and(
              sql`${workflowExecutionLogs.startedAt} < (${options.before}::timestamptz AT TIME ZONE 'UTC')`,
              cursorPredicate
            )
          )
          .orderBy(direction(workflowExecutionLogs.startedAt), direction(workflowExecutionLogs.id))
          .limit(Math.max(TRACE_BATCH_SIZE, options.concurrency * 2))
      )

      if (rows.length === 0) break
      if (signal?.aborted) break

      /** Only sizes leave PostgreSQL until the scheduler reserves payload capacity. */
      const sizes = await measure('size', () =>
        execDb
          .select({
            id: workflowExecutionLogs.id,
            payloadBytes: sql<number>`octet_length(${workflowExecutionLogs.executionData}::text)`,
          })
          .from(workflowExecutionLogs)
          .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
          .where(
            and(
              inArray(
                workflowExecutionLogs.id,
                rows.map(({ id }) => id)
              ),
              pending
            )
          )
          .limit(rows.length)
      )
      const bytesById = new Map<string, number>()
      for (const { id, payloadBytes } of sizes) {
        if (payloadBytes > MAX_DURABLE_LARGE_VALUE_BYTES) {
          if (!options.skipOversized) {
            throw new Error(
              `Execution log ${id} is ${payloadBytes} bytes, exceeding the ${MAX_DURABLE_LARGE_VALUE_BYTES}-byte backfill limit; use --skip-oversized to leave oversized logs inline and continue`
            )
          }
          skippedOversized++
          logger.warn('Skipping oversized execution log; leaving data inline', {
            executionLogId: id,
            payloadBytes,
            limitBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
          })
          continue
        }
        bytesById.set(id, payloadBytes)
      }
      const candidates = rows.flatMap(({ id }) => {
        const payloadBytes = bytesById.get(id)
        return payloadBytes === undefined ? [] : [{ id, payloadBytes }]
      })
      skipped += rows.length - candidates.length

      const completed = await runBackfillWorkers(
        candidates,
        options.concurrency,
        async ({ id, payloadBytes }) => {
          try {
            /** Reject oversized JSON in SQL before the driver materializes it. */
            const [row] = await measure('read', () =>
              execDb
                .select({
                  id: workflowExecutionLogs.id,
                  workspaceId: workflowExecutionLogs.workspaceId,
                  workflowId: workflowExecutionLogs.workflowId,
                  executionId: workflowExecutionLogs.executionId,
                  workflowOwnerUserId: workflow.userId,
                  payloadBytes: sql<number>`octet_length(${workflowExecutionLogs.executionData}::text)`,
                  executionData: sql<Record<string, unknown> | null>`CASE
              WHEN octet_length(${workflowExecutionLogs.executionData}::text) <= ${payloadBytes}
              THEN ${workflowExecutionLogs.executionData}
              ELSE NULL END`,
                })
                .from(workflowExecutionLogs)
                .innerJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
                .where(and(eq(workflowExecutionLogs.id, id), pending))
                .limit(1)
            )
            /** Skip running, deleted-workflow, already externalized, or removed rows. */
            if (!row) {
              skipped++
              return
            }
            if (!row.workflowOwnerUserId) throw new Error('Workflow owner is missing')
            if (row.payloadBytes > payloadBytes) {
              throw new Error(
                `Execution payload grew from ${payloadBytes} to ${row.payloadBytes} bytes after reserving memory; resume from the last checkpoint`
              )
            }
            const executionData = row.executionData
            if (!executionData) throw new Error('Execution data is missing')
            const traceSpanCount = countTraceSpans(executionData.traceSpans)
            executionData.hasTraceSpans = traceSpanCount > 0
            executionData.traceSpanCount = traceSpanCount
            stripSpanCosts(executionData.traceSpans)
            /**
             * Use the workflow's FK-backed owner for file metadata: the historical
             * execution user may be deleted and stays unchanged inside the payload.
             */
            const slim = await measure('externalize', () =>
              externalizeExecutionData(
                executionData,
                {
                  workspaceId: row.workspaceId,
                  workflowId: row.workflowId,
                  executionId: row.executionId,
                  userId: row.workflowOwnerUserId,
                },
                { throwOnError: true }
              )
            )

            if (!(TRACE_STORE_REF_KEY in slim)) {
              throw new Error('Trace storage did not return a durable reference')
            }

            await measure('commit', () =>
              execDb.transaction(async (tx) => {
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
            )

            migrated++
          } catch (error) {
            throw new Error(`Backfill failed for execution log ${id}`, { cause: error })
          }
        },
        {
          signal,
          byteBudget: {
            maxBytes: options.maxInFlightMiB * MIB,
            sizeOf: ({ payloadBytes }) => payloadBytes,
          },
        }
      )

      if (completed !== candidates.length) break

      const last = rows[rows.length - 1]
      cursor = {
        version: 1,
        order: options.order,
        before: options.before,
        startedAt: last.startedAt,
        id: last.id,
      }
      reportCheckpoint()

      reportProgress()
    }
  } finally {
    clearInterval(progressTimer)
    reportProgress()
    reportCheckpoint()
  }

  return { migrated, skippedOversized }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()

  logger.info('Starting trace backfill', {
    concurrency: options.concurrency,
    maxInFlightMiB: options.maxInFlightMiB,
    checkOnly: options.checkOnly,
    skipOversized: options.skipOversized,
  })
  const controller = new AbortController()
  const stop = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) return
    logger.warn('Stopping backfill; draining active workers before exiting', { signal })
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    controller.abort()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    const result = await backfillTraceStorage(options, controller.signal)
    logger.info(
      controller.signal.aborted
        ? 'Backfill interrupted'
        : options.checkOnly
          ? 'Database check complete'
          : 'Backfill run finished',
      {
        ...result,
        elapsedSeconds: (Date.now() - startedAt) / 1000,
      }
    )
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      logger.error('Backfill failed', describeError(error))
      process.exit(1)
    }
  )
}
