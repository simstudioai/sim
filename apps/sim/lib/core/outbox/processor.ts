import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  OUTBOX_PROCESSOR_MAX_RUNTIME_MS,
  OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS,
} from '@/lib/core/outbox/constants'
import { OUTBOX_HANDLER_GROUPS } from '@/lib/core/outbox/handlers'
import { pruneCompletedOutboxEvents } from '@/lib/core/outbox/retention'
import { type ProcessOutboxResult, processOutboxEvents } from '@/lib/core/outbox/service'
import { DeadlineExceededError } from '@/lib/core/utils/deadline'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import { recoverKnowledgeDocumentProcessing } from '@/lib/knowledge/documents/processing-recovery'
import { reapStaleBackgroundWork } from '@/ee/workspace-forking/lib/background-work/store'

const logger = createLogger('OutboxProcessor')

export interface OutboxProcessorResult {
  result: ProcessOutboxResult
  recoveredDocuments: number
  reapedBackgroundWork: number
  prunedEvents: number
}

/** Processes one bounded batch and its recovery work in either the worker or self-hosted cron. */
export async function runOutboxProcessor(): Promise<OutboxProcessorResult> {
  const startedAt = Date.now()
  const result = await processOutboxEvents(OUTBOX_HANDLER_GROUPS, {
    batchSize: 500,
    maxRuntimeMs: OUTBOX_PROCESSOR_MAX_RUNTIME_MS,
    minRemainingMs: 95_000,
  })

  let recoveredDocuments = 0
  try {
    if (Date.now() - startedAt < OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS) {
      recoveredDocuments = await recoverKnowledgeDocumentProcessing()
    }
  } catch (error) {
    logger.error('Stored document recovery failed', {
      error: getConnectorFailureDiagnostic(error) ?? {
        category: error instanceof DeadlineExceededError ? 'deadline' : 'internal',
        message:
          error instanceof DeadlineExceededError
            ? error.message
            : 'Unexpected stored-document recovery failure',
      },
    })
  }

  /** Reap independently so an expired fork lease cannot prevent outbox delivery. */
  let reapedBackgroundWork = 0
  try {
    reapedBackgroundWork = await reapStaleBackgroundWork(db)
  } catch (error) {
    logger.error('Background-work reap failed', { error: toError(error).message })
  }

  let prunedEvents = 0
  try {
    prunedEvents = await pruneCompletedOutboxEvents()
  } catch (error) {
    logger.error('Completed outbox pruning failed', { error: toError(error).message })
  }

  const output = { result, reapedBackgroundWork, recoveredDocuments, prunedEvents }
  logger.info('Outbox processing completed', {
    ...result,
    reapedBackgroundWork,
    recoveredDocuments,
    prunedEvents,
    durationMs: Date.now() - startedAt,
  })
  /** Fail the run so a broken handler module stays as visible as the crash its static import caused. */
  if (result.unloadedEventTypes.length > 0) {
    throw new Error(
      `Outbox handler modules failed to load; left pending: ${result.unloadedEventTypes.join(', ')}`
    )
  }
  return output
}
