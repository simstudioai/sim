import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { runs } from '@trigger.dev/sdk'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { documentProcessingRecoveryCondition } from '@/lib/knowledge/documents/processing-recovery-policy'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const logger = createLogger('DocumentRecoveryQueue')
const LOOKUP_CONCURRENCY = 4
const LOOKUP_BUDGET_MS = 10_000
const RECHECK_DELAY_MS = 15 * 60_000

export interface DocumentRecoveryGeneration {
  id: string
  processingQueueToken: string | null
  processingQueuedAt: Date | null
  processingStartedAt: Date | null
  uploadedAt: Date
}

/** Recovery may replace only the generation whose queue state was inspected outside the transaction. */
export function documentRecoveryGenerationCondition(candidate: DocumentRecoveryGeneration) {
  return and(
    eq(document.id, candidate.id),
    candidate.processingQueueToken === null
      ? isNull(document.processingQueueToken)
      : eq(document.processingQueueToken, candidate.processingQueueToken),
    candidate.processingQueuedAt === null
      ? isNull(document.processingQueuedAt)
      : eq(document.processingQueuedAt, candidate.processingQueuedAt),
    candidate.processingStartedAt === null
      ? isNull(document.processingStartedAt)
      : eq(document.processingStartedAt, candidate.processingStartedAt)
  )
}

/**
 * Queue age is not evidence of abandonment. Any live run for the document protects
 * it, including legacy dispatches and continuations. Lookup failures fail closed.
 * Callers supply bounded candidate pages; only one metadata row is read per lookup.
 */
export async function filterAbandonedDocumentProcessing<T extends DocumentRecoveryGeneration>(
  candidates: T[],
  signal?: AbortSignal
): Promise<T[]> {
  if (!candidates.length || (!isTriggerDevEnabled && !isInsideTriggerRun())) return candidates

  const abandoned: T[] = []
  let lookupError: unknown
  try {
    await withinDeadline(
      async (lookupSignal) => {
        await mapWithConcurrency(candidates, LOOKUP_CONCURRENCY, async (candidate) => {
          lookupSignal.throwIfAborted()
          if (lookupError) return
          const page = await runs
            .list(
              {
                taskIdentifier: 'knowledge-process-document',
                tag: `documentId:${candidate.id}`,
                /** Include the entire eligible document lifetime, with the existing dispatch grace for clock skew. */
                from: new Date(candidate.uploadedAt.getTime() - QUEUED_DISPATCH_GRACE_MS),
                status: [
                  'PENDING_VERSION',
                  'DELAYED',
                  'QUEUED',
                  'DEQUEUED',
                  'EXECUTING',
                  'WAITING',
                ],
                limit: 1,
              },
              { retry: { maxAttempts: 1 } }
            )
            .catch((error: unknown) => {
              lookupError = error
              return null
            })
          lookupSignal.throwIfAborted()
          if (page?.data.length === 0) abandoned.push(candidate)
        })
        if (lookupError) throw lookupError
      },
      Date.now() + LOOKUP_BUDGET_MS,
      signal
    )
  } catch (error) {
    signal?.throwIfAborted()
    logger.warn('Could not verify all document jobs; leaving unverified generations unchanged', {
      candidates: candidates.length,
      abandoned: abandoned.length,
      error: getErrorMessage(error),
    })
  }

  signal?.throwIfAborted()
  const abandonedIds = new Set(abandoned.map((candidate) => candidate.id))
  const retained = candidates.filter((candidate) => !abandonedIds.has(candidate.id))
  if (retained.length) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`
        )
        signal?.throwIfAborted()
        await tx
          .update(document)
          .set({ processingRecoveryAfter: new Date(Date.now() + RECHECK_DELAY_MS) })
          .where(
            and(
              documentProcessingRecoveryCondition(new Date()),
              or(...retained.map(documentRecoveryGenerationCondition))
            )
          )
        signal?.throwIfAborted()
      })
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Could not postpone document queue recheck', { error: getErrorMessage(error) })
    }
  }
  return [...abandoned]
}
