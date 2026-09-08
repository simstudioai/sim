import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { env, envNumber } from '@/lib/core/config/env'
import {
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
} from '@/lib/embeddings'
import {
  isPermanentDocumentProcessingError,
  isUsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import {
  assertDocumentProcessingBillingContext,
  assertDocumentProcessingPayload,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'
import {
  canScheduleDocumentProcessingQuotaContinuation,
  MAX_QUOTA_CONTINUATION_ATTEMPTS,
  resolveQuotaContinuationDelayMs,
  scheduleDocumentProcessingQuotaContinuation,
} from '@/lib/knowledge/documents/processing-quota-continuation'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const logger = createLogger('TriggerKnowledgeProcessing')
export { resolveQuotaContinuationDelayMs }

export async function runDocumentProcessing(
  rawPayload: DocumentProcessingPayload,
  attemptNumber = 1
) {
  const startedAt = Date.now()
  const payload = assertDocumentProcessingPayload(rawPayload)
  const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload
  const billingContext = assertDocumentProcessingBillingContext(payload)
  const canScheduleQuotaContinuation = canScheduleDocumentProcessingQuotaContinuation(payload)

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
        chargedAtDispatch:
          (payload.chargedAtDispatch ?? payload.processingQueuedAt !== undefined) &&
          attemptNumber === 1 &&
          payload.quotaRetryCount === undefined,
        ...(payload.processingQueueToken
          ? { processingQueueToken: payload.processingQueueToken }
          : {}),
        ...(payload.processingQueuedAt
          ? { processingQueuedAt: new Date(payload.processingQueuedAt) }
          : {}),
        ...(canScheduleQuotaContinuation
          ? {
              scheduleQuotaContinuation: () => scheduleDocumentProcessingQuotaContinuation(payload),
            }
          : { quotaContinuationExhausted: true }),
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
    if (isUsageLimitDocumentProcessingError(error)) {
      logger.warn(`[${requestId}] Document processing is blocked by the current usage limit`, {
        filename: docData.filename,
      })
      return {
        success: false,
        outcome: 'usage_limit' as const,
        documentId,
        filename: docData.filename,
        error: error.message,
        processingTime: Date.now() - startedAt,
      }
    }
    if (isEmbeddingQuotaExhaustion(error)) {
      const outcome = canScheduleQuotaContinuation ? 'quota_deferred' : 'quota_exhausted'
      logger.warn(`[${requestId}] Embedding quota is exhausted`, {
        filename: docData.filename,
        quotaRetryCount: payload.quotaRetryCount ?? 0,
        continuationLimit: MAX_QUOTA_CONTINUATION_ATTEMPTS,
        outcome,
      })
      return {
        success: false,
        outcome,
        documentId,
        filename: docData.filename,
        error: EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
        processingTime: Date.now() - startedAt,
      }
    }
    if (isBYOKEmbeddingCredentialRejection(error)) {
      logger.warn(`[${requestId}] Customer-managed embedding credentials were rejected`, {
        filename: docData.filename,
        status: error.status,
      })
      return {
        success: false,
        outcome: 'customer_configuration' as const,
        code: 'embedding_credentials_rejected' as const,
        documentId,
        filename: docData.filename,
        error: BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
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
  /**
   * Sized from production telemetry: peak sampled RSS 902 MB and peak 1.2 vCPU
   * across a corpus where no document exceeded 2 GB, so `medium-2x` holds ~4x
   * memory and ~1.7x CPU headroom over the observed worst case. The prior
   * `large-1x` reserved 8 GB against a worst case using an eighth of it.
   */
  machine: 'medium-2x',
  retry: {
    maxAttempts: envNumber(env.KB_CONFIG_MAX_ATTEMPTS, 3),
    factor: envNumber(env.KB_CONFIG_RETRY_FACTOR, 2),
    minTimeoutInMs: envNumber(env.KB_CONFIG_MIN_TIMEOUT, 1000),
    maxTimeoutInMs: envNumber(env.KB_CONFIG_MAX_TIMEOUT, 10000),
    /**
     * `maxAttempts` does not cover an out-of-memory kill — Trigger.dev retries
     * `TASK_PROCESS_OOM_KILLED` only when a larger preset is named here. The
     * escalation is a safety net after parser allocations have been bounded.
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
