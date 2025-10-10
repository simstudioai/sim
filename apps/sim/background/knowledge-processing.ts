import { task } from '@trigger.dev/sdk'
import { env } from '@/lib/env'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('TriggerKnowledgeProcessing')

export type DocumentProcessingPayload = {
  knowledgeBaseId: string
  documentId: string
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }
  processingOptions: {
    chunkSize?: number
    minCharactersPerChunk?: number
    recipe?: string
    lang?: string
    chunkOverlap?: number
  }
  requestId: string
}

export const processDocument = task({
  id: 'knowledge-process-document',
  maxDuration: env.KB_CONFIG_MAX_DURATION || 600,
  retry: {
    maxAttempts: env.KB_CONFIG_MAX_ATTEMPTS || 3,
    factor: env.KB_CONFIG_RETRY_FACTOR || 2,
    minTimeoutInMs: env.KB_CONFIG_MIN_TIMEOUT || 1000,
    maxTimeoutInMs: env.KB_CONFIG_MAX_TIMEOUT || 10000,
  },
  queue: {
    concurrencyLimit: env.KB_CONFIG_CONCURRENCY_LIMIT || 20,
    name: 'document-processing-queue',
  },
  run: async (payload: DocumentProcessingPayload) => {
    const { knowledgeBaseId, documentId, docData, processingOptions, requestId } = payload

    logger.info(`[${requestId}] Starting Trigger.dev processing for document: ${docData.filename}`)

    try {
      await processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions)

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
  },
})
