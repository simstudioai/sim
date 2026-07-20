import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { env, envNumber } from '@/lib/core/config/env'
import {
  assertDocumentProcessingPayload,
  type DocumentProcessingBillingContext,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const logger = createLogger('TriggerKnowledgeProcessing')

export async function runDocumentProcessing(rawPayload: DocumentProcessingPayload) {
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
      billingContext
    )

    logger.info(`[${requestId}] Successfully processed document: ${docData.filename}`)

    return {
      success: true,
      documentId,
      filename: docData.filename,
      processingTime: Date.now(),
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to process document: ${docData.filename}`, error)
    throw error
  }
}

export const processDocument = task({
  id: 'knowledge-process-document',
  maxDuration: envNumber(env.KB_CONFIG_MAX_DURATION, 600),
  machine: 'large-1x', // 2 vCPU, 2GB RAM - needed for large PDF processing
  retry: {
    maxAttempts: envNumber(env.KB_CONFIG_MAX_ATTEMPTS, 3),
    factor: envNumber(env.KB_CONFIG_RETRY_FACTOR, 2),
    minTimeoutInMs: envNumber(env.KB_CONFIG_MIN_TIMEOUT, 1000),
    maxTimeoutInMs: envNumber(env.KB_CONFIG_MAX_TIMEOUT, 10000),
  },
  queue: {
    concurrencyLimit: envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20),
    name: 'document-processing-queue',
  },
  run: runDocumentProcessing,
})
