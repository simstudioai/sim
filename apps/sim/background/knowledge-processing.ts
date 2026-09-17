import { createLogger } from '@sim/logger'
import { queue, task } from '@trigger.dev/sdk'
import { env, envNumber } from '@/lib/core/config/env'
import {
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
} from '@/lib/embeddings'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import {
  getOcrRequestRejection,
  isPermanentDocumentProcessingError,
  isUsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import {
  BACKFILL_PROCESSING_QUEUE_NAME,
  INTERACTIVE_PROCESSING_QUEUE_NAME,
} from '@/lib/knowledge/documents/processing-lane'
import {
  assertDocumentProcessingBillingContext,
  assertDocumentProcessingPayload,
  type DocumentProcessingPayload,
  shouldRefundDocumentProcessingPredecessor,
} from '@/lib/knowledge/documents/processing-payload'
import { scheduleDocumentProcessingProviderContinuation } from '@/lib/knowledge/documents/processing-provider-continuation'
import {
  getProviderCapacityDeferral,
  ProviderCapacityContinuationExhaustedError,
} from '@/lib/knowledge/documents/processing-provider-deferral'
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
  const chargedAtDispatch =
    (payload.chargedAtDispatch ?? payload.processingQueuedAt !== undefined) &&
    attemptNumber === 1 &&
    payload.quotaRetryCount === undefined &&
    payload.providerRetryCount === undefined &&
    payload.processingSliceCount === undefined

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
        chargedAtDispatch,
        ...(payload.processingPredecessorToken
          ? {
              processingPredecessorToken: payload.processingPredecessorToken,
              refundPredecessorAdmission: shouldRefundDocumentProcessingPredecessor(payload),
            }
          : {}),
        ...(payload.processingQueueToken
          ? { processingQueueToken: payload.processingQueueToken }
          : {}),
        ...(payload.processingQueuedAt
          ? { processingQueuedAt: new Date(payload.processingQueuedAt) }
          : {}),
        ...(canScheduleQuotaContinuation
          ? {
              scheduleQuotaContinuation: () =>
                scheduleDocumentProcessingQuotaContinuation(payload, true, chargedAtDispatch),
            }
          : { quotaContinuationExhausted: true }),
        scheduleProviderContinuation: (error) =>
          scheduleDocumentProcessingProviderContinuation(payload, error, true, chargedAtDispatch),
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
    const providerDeferral = getProviderCapacityDeferral(error)
    if (providerDeferral || error instanceof ProviderCapacityContinuationExhaustedError) {
      const outcome =
        error instanceof ProviderCapacityContinuationExhaustedError
          ? 'provider_exhausted'
          : 'provider_deferred'
      logger.warn(`[${requestId}] Document processing is waiting for provider recovery`, {
        documentId,
        providerRetryCount: payload.providerRetryCount ?? 0,
        reason: providerDeferral?.reason,
        outcome,
      })
      return {
        success: false,
        outcome,
        documentId,
        filename: docData.filename,
        error:
          error instanceof ProviderCapacityContinuationExhaustedError
            ? error.message
            : providerDeferral!.message,
        processingTime: Date.now() - startedAt,
      }
    }
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
    const ocrRejection = getOcrRequestRejection(error)
    if (ocrRejection) {
      logger.warn(`[${requestId}] OCR request requires remediation before retrying`, {
        status: ocrRejection.status,
        code: ocrRejection.code,
      })
      return {
        success: false,
        outcome: 'provider_request_rejected' as const,
        documentId,
        filename: docData.filename,
        code: ocrRejection.code,
        error: ocrRejection.message,
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
    const diagnostic = getConnectorFailureDiagnostic(error)
    logger.error(
      `[${requestId}] Failed to process document: ${docData.filename}`,
      diagnostic ?? error
    )
    if (diagnostic?.category === 'database') throw new Error(diagnostic.message)
    throw error
  }
}

/**
 * Both lanes are keyed by tenant at dispatch, so `concurrencyLimit` is the
 * ceiling one tenant may hold in that lane, not a ceiling for the fleet. The
 * shared bound is the Trigger.dev environment concurrency limit, which is where
 * a global ceiling belongs; observed peak there is ~97 across every task.
 *
 * Both default to the limit the single shared queue carried, which is what
 * keeps this split from ever draining slower than the queue it replaces: the
 * busiest case it has to beat is one tenant alone, and one tenant alone still
 * gets the same slots it used to get for backfill plus a separate allowance for
 * work someone is waiting on. Any second tenant is pure gain, because under the
 * shared queue it got whatever the first one left.
 *
 * Splitting the two into separate variables is for operating them, not for
 * sizing them: backfill is the one to lower when the environment ceiling is the
 * binding constraint, and lowering it must not slow down a person's upload.
 */
export const interactiveProcessingQueue = queue({
  name: INTERACTIVE_PROCESSING_QUEUE_NAME,
  concurrencyLimit: envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20),
})

/** Referenced by no dispatch site: named per trigger, declared here so the deploy registers it. */
export const backfillProcessingQueue = queue({
  name: BACKFILL_PROCESSING_QUEUE_NAME,
  concurrencyLimit: envNumber(env.KB_CONFIG_BACKFILL_CONCURRENCY_LIMIT, 20),
})

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
  /**
   * The lane every dispatch names explicitly. Declared here as well so a
   * trigger that somehow omits the option still lands on a registered queue
   * rather than waiting in `PENDING_VERSION` for one that does not exist.
   */
  queue: interactiveProcessingQueue,
  run: (payload: DocumentProcessingPayload, { ctx }) =>
    runDocumentProcessing(payload, ctx.attempt.number),
})
