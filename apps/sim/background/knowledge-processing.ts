import { createLogger } from '@sim/logger'
import { task, tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { env, envNumber } from '@/lib/core/config/env'
import { EMBEDDING_QUOTA_EXHAUSTED_MESSAGE, isEmbeddingQuotaExhaustion } from '@/lib/embeddings'
import { EMBEDDING_QUOTA_CIRCUIT_TTL_MS } from '@/lib/embeddings/quota-circuit'
import { isPermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import {
  assertDocumentProcessingPayload,
  type DocumentProcessingBillingContext,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const logger = createLogger('TriggerKnowledgeProcessing')
const MAX_QUOTA_CONTINUATION_DELAY_MS = 6 * 60 * 60 * 1000
const MAX_QUOTA_BACKOFF_EXPONENT = Math.ceil(
  Math.log2(MAX_QUOTA_CONTINUATION_DELAY_MS / EMBEDDING_QUOTA_CIRCUIT_TTL_MS)
)

/** Backs durable quota continuations off to a six-hour polling ceiling. */
export function resolveQuotaContinuationDelayMs(quotaRetryCount: number): number {
  const exponent = Math.min(Math.max(quotaRetryCount - 1, 0), MAX_QUOTA_BACKOFF_EXPONENT)
  return Math.min(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 2 ** exponent, MAX_QUOTA_CONTINUATION_DELAY_MS)
}

/**
 * Hands quota-blocked work to a new delayed run before the current run completes.
 * A Trigger run has a finite attempt budget, so retrying the same run can still
 * strand an upload during a prolonged outage. Chaining acknowledged runs keeps
 * recovery durable until credit returns; a failed handoff throws and consumes the
 * current run's ordinary infrastructure retries instead of claiming success.
 */
async function scheduleQuotaContinuation(payload: DocumentProcessingPayload): Promise<void> {
  const quotaRetryCount = (payload.quotaRetryCount ?? 0) + 1
  const delayMs = resolveQuotaContinuationDelayMs(quotaRetryCount)
  await tasks.trigger(
    'knowledge-process-document',
    { ...payload, quotaRetryCount },
    {
      delay: new Date(Date.now() + delayMs),
      idempotencyKey: `knowledge-quota-${payload.documentId}-${payload.requestId}-${quotaRetryCount}`,
      tags: [`knowledgeBaseId:${payload.knowledgeBaseId}`, `documentId:${payload.documentId}`],
      region: await resolveTriggerRegion(),
    }
  )
}

export async function runDocumentProcessing(
  rawPayload: DocumentProcessingPayload,
  attemptNumber = 1
) {
  const startedAt = Date.now()
  const payload = assertDocumentProcessingPayload(rawPayload)
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload
  const billingContext: DocumentProcessingBillingContext =
    payload.billingScope === 'workspace'
      ? {
          billingScope: 'workspace',
          actorUserId: payload.actorUserId,
          workspaceId: payload.workspaceId,
          billingAttribution: payload.billingAttribution,
        }
      : {
          billingScope: 'non-workspace',
          actorUserId: payload.actorUserId,
          workspaceId: null,
        }

  logger.info(`[${requestId}] Starting Trigger.dev processing for document: ${docData.filename}`)

  try {
    await processDocumentAsync(
      knowledgeBaseId,
      documentId,
      docData,
      processingOptions,
      billingContext,
      requestId,
      {
        chargedAtDispatch: attemptNumber === 1 && payload.quotaRetryCount === undefined,
        processingQueuedAt: new Date(payload.processingQueuedAt),
      }
    )

    logger.info(`[${requestId}] Successfully processed document: ${docData.filename}`)

    return {
      success: true,
      documentId,
      filename: docData.filename,
      processingTime: Date.now() - startedAt,
    }
  } catch (error) {
    if (isEmbeddingQuotaExhaustion(error)) {
      logger.warn(`[${requestId}] Embedding quota is exhausted; scheduling a continuation`, {
        filename: docData.filename,
        quotaRetryCount: payload.quotaRetryCount ?? 0,
      })
      await scheduleQuotaContinuation(payload)
      return {
        success: false,
        outcome: 'quota_deferred' as const,
        documentId,
        filename: docData.filename,
        error: EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
        processingTime: Date.now() - startedAt,
      }
    }
    if (isPermanentDocumentProcessingError(error)) {
      logger.warn(`[${requestId}] Document cannot be processed without changing its content`, {
        code: error.code,
        filename: docData.filename,
      })
      return {
        success: false,
        outcome: 'permanent_failure' as const,
        documentId,
        filename: docData.filename,
        code: error.code,
        error: error.message,
        processingTime: Date.now() - startedAt,
      }
    }
    logger.error(`[${requestId}] Failed to process document: ${docData.filename}`, error)
    throw error
  }
}

export const processDocument = task({
  id: 'knowledge-process-document',
  maxDuration: envNumber(env.KB_CONFIG_MAX_DURATION, 600),
  machine: 'large-1x', // 4 vCPU, 8GB RAM - needed for large PDF processing
  retry: {
    maxAttempts: envNumber(env.KB_CONFIG_MAX_ATTEMPTS, 3),
    factor: envNumber(env.KB_CONFIG_RETRY_FACTOR, 2),
    minTimeoutInMs: envNumber(env.KB_CONFIG_MIN_TIMEOUT, 1000),
    maxTimeoutInMs: envNumber(env.KB_CONFIG_MAX_TIMEOUT, 10000),
    /**
     * `maxAttempts` does not cover an out-of-memory kill — Trigger.dev retries
     * `TASK_PROCESS_OOM_KILLED` only when a larger preset is named here. Eleven
     * documents were killed in one afternoon and every one recorded
     * `attempt_count = 1`, so each was left `failed` with no retry at all. The
     * escalation is a safety net, not the fix: the workbook parser's allocation
     * no longer scales with a sheet's declared range, and fleet p99 memory is
     * 691 MB against this machine's 8 GB.
     */
    outOfMemory: { machine: 'large-2x' },
  },
  queue: {
    concurrencyLimit: envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20),
    name: 'document-processing-queue',
  },
  run: (payload: DocumentProcessingPayload, { ctx }) =>
    runDocumentProcessing(payload, ctx.attempt.number),
})
