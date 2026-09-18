import { db } from '@sim/db'
import { document, outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { apiClientManager, ListRunResponseItem, type RunStatus } from '@trigger.dev/core/v3'
import { zodfetchCursorPage } from '@trigger.dev/core/v3/zodfetch'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import { withinDeadline } from '@/lib/core/utils/deadline'

const logger = createLogger('DocumentProcessingLiveness')
export const DOCUMENT_LIVENESS_BATCH_SIZE = 200
const LOOKUP_CONCURRENCY = 4
const LOOKUP_BUDGET_MS = 8_000
const LIVE_RECHECK_MS = 15 * 60_000
const UNKNOWN_RECHECK_MS = 60_000
type TriggerRunStatus = Extract<RunStatus, string>

/** Exhaustive against the SDK: adding a lifecycle state requires classifying it here. */
const RUN_STATUS_LIVENESS = {
  PENDING_VERSION: true,
  QUEUED: true,
  DEQUEUED: true,
  EXECUTING: true,
  WAITING: true,
  DELAYED: true,
  COMPLETED: false,
  CANCELED: false,
  FAILED: false,
  CRASHED: false,
  SYSTEM_FAILURE: false,
  EXPIRED: false,
  TIMED_OUT: false,
} satisfies Record<TriggerRunStatus, boolean>
const ACTIVE_RUN_STATUSES = (Object.keys(RUN_STATUS_LIVENESS) as TriggerRunStatus[]).filter(
  (status) => RUN_STATUS_LIVENESS[status]
)

export const processingSnapshotColumns = {
  id: document.id,
  processingStatus: document.processingStatus,
  processingQueueToken: document.processingQueueToken,
  processingQueuedAt: document.processingQueuedAt,
  processingStartedAt: document.processingStartedAt,
  processingDeferredUntil: document.processingDeferredUntil,
  processingCompletedAt: document.processingCompletedAt,
}

export type DocumentProcessingSnapshot = Pick<
  typeof document.$inferSelect,
  keyof typeof processingSnapshotColumns
>

/** A claim or continuation installed during the external lookup must win over recovery. */
export function documentProcessingSnapshotCondition(snapshot: DocumentProcessingSnapshot) {
  return and(
    eq(document.id, snapshot.id),
    eq(document.processingStatus, snapshot.processingStatus),
    sql`${document.processingQueueToken} IS NOT DISTINCT FROM ${snapshot.processingQueueToken}`,
    sql`${document.processingQueuedAt} IS NOT DISTINCT FROM ${sql.param(snapshot.processingQueuedAt, document.processingQueuedAt)}`,
    sql`${document.processingStartedAt} IS NOT DISTINCT FROM ${sql.param(snapshot.processingStartedAt, document.processingStartedAt)}`,
    sql`${document.processingDeferredUntil} IS NOT DISTINCT FROM ${sql.param(snapshot.processingDeferredUntil, document.processingDeferredUntil)}`,
    sql`${document.processingCompletedAt} IS NOT DISTINCT FROM ${sql.param(snapshot.processingCompletedAt, document.processingCompletedAt)}`
  )
}

type ProcessingLiveness = 'live' | 'abandoned' | 'unknown'

async function inspectTriggerWork(documentId: string, deadlineAt: number, signal?: AbortSignal) {
  return withinDeadline(
    async (requestSignal) => {
      const client = apiClientManager.clientOrThrow()
      /** The SDK's runs.list wrapper omits RequestInit.signal; its transport supports it. */
      const page = await zodfetchCursorPage(
        ListRunResponseItem,
        `${client.baseUrl}/api/v1/runs`,
        {
          query: new URLSearchParams({
            'filter[taskIdentifier]': 'knowledge-process-document',
            'filter[tag]': `documentId:${documentId}`,
            'filter[status]': ACTIVE_RUN_STATUSES.join(','),
          }),
          limit: 1,
        },
        { method: 'GET', headers: client.getHeaders(), signal: requestSignal },
        { retry: { maxAttempts: 1 } }
      )
      requestSignal.throwIfAborted()
      if (page.data.length > 0) return 'live' as const
      return page.hasNextPage() ? ('unknown' as const) : ('abandoned' as const)
    },
    deadlineAt,
    signal
  )
}

/**
 * Age only nominates candidates. Inspect durable work before replacing its generation,
 * outside row locks. Any live document run protects continuation handoffs and legacy jobs.
 * Failed or incomplete lookups defer recovery; they never authorize another admission.
 */
export async function inspectDocumentProcessingLiveness<T extends DocumentProcessingSnapshot>(
  candidates: readonly T[],
  signal?: AbortSignal
): Promise<{ abandoned: T[]; live: T[] }> {
  if (candidates.length === 0) return { abandoned: [], live: [] }
  if (candidates.length > DOCUMENT_LIVENESS_BATCH_SIZE) {
    throw new Error('Document liveness batch exceeds its limit')
  }
  signal?.throwIfAborted()
  const deadlineAt = Date.now() + LOOKUP_BUDGET_MS
  const states = new Map<string, ProcessingLiveness>()
  try {
    const tokens = candidates.flatMap((row) =>
      row.processingQueueToken ? [row.processingQueueToken] : []
    )
    const carriers =
      tokens.length === 0
        ? []
        : await db.transaction(async (tx) => {
            signal?.throwIfAborted()
            await tx.execute(
              sql`SELECT set_config('statement_timeout', '2000', true), set_config('lock_timeout', '500', true)`
            )
            signal?.throwIfAborted()
            return tx
              .select({ id: outboxEvent.id })
              .from(outboxEvent)
              .where(
                and(
                  inArray(outboxEvent.id, tokens),
                  inArray(outboxEvent.status, ['pending', 'processing'])
                )
              )
              .limit(DOCUMENT_LIVENESS_BATCH_SIZE)
          })
    const liveTokens = new Set(carriers.map((row) => row.id))
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(LOOKUP_CONCURRENCY, candidates.length) }, async () => {
        while (next < candidates.length && Date.now() < deadlineAt && !signal?.aborted) {
          const candidate = candidates[next++]!
          if (candidate.processingQueueToken && liveTokens.has(candidate.processingQueueToken)) {
            states.set(candidate.id, 'live')
            continue
          }
          if (!(isInsideTriggerRun() || (isTriggerDevEnabled && env.TRIGGER_SECRET_KEY))) {
            states.set(candidate.id, 'abandoned')
            continue
          }
          try {
            states.set(candidate.id, await inspectTriggerWork(candidate.id, deadlineAt, signal))
          } catch {
            states.set(candidate.id, 'unknown')
          }
        }
      })
    )
  } catch {
    /** Missing outbox evidence cannot establish abandonment either. */
  }
  signal?.throwIfAborted()

  for (const state of ['live', 'unknown'] as const) {
    const protectedRows = candidates.filter((row) => (states.get(row.id) ?? 'unknown') === state)
    if (protectedRows.length === 0) continue
    try {
      await db.transaction(async (tx) => {
        signal?.throwIfAborted()
        await tx.execute(
          sql`SELECT set_config('statement_timeout', '2000', true), set_config('lock_timeout', '500', true)`
        )
        signal?.throwIfAborted()
        await tx
          .update(document)
          .set({
            processingRecoveryAfter: new Date(
              Date.now() + (state === 'live' ? LIVE_RECHECK_MS : UNKNOWN_RECHECK_MS)
            ),
          })
          .where(or(...protectedRows.map(documentProcessingSnapshotCondition)))
      })
    } catch {
      signal?.throwIfAborted()
      logger.warn('Document recovery cooldown could not be persisted', {
        count: protectedRows.length,
      })
    }
    if (state === 'unknown')
      logger.warn('Document recovery deferred: work status could not be established', {
        count: protectedRows.length,
      })
  }
  return {
    abandoned: candidates.filter((row) => states.get(row.id) === 'abandoned'),
    live: candidates.filter((row) => states.get(row.id) === 'live'),
  }
}

export async function findAbandonedDocumentProcessing<T extends DocumentProcessingSnapshot>(
  candidates: readonly T[],
  signal?: AbortSignal
): Promise<T[]> {
  return (await inspectDocumentProcessingLiveness(candidates, signal)).abandoned
}
