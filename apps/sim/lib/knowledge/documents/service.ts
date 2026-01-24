import crypto, { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { getStorageMethod, isRedisStorage } from '@/lib/core/storage'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { DocumentProcessingQueue } from '@/lib/knowledge/documents/queue'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import {
  buildUndefinedTagsError,
  parseBooleanValue,
  parseDateValue,
  parseNumberValue,
  validateTagValue,
} from '@/lib/knowledge/tags/utils'
import type { ProcessedDocumentTags } from '@/lib/knowledge/types'
import type { DocumentProcessingPayload } from '@/background/knowledge-processing'

const logger = createLogger('DocumentService')

const TIMEOUTS = {
  OVERALL_PROCESSING: (env.KB_CONFIG_MAX_DURATION || 600) * 1000, // Default 10 minutes for KB document processing
  EMBEDDINGS_API: (env.KB_CONFIG_MAX_TIMEOUT || 10000) * 18,
} as const

// Configuration for handling large documents
const LARGE_DOC_CONFIG = {
  MAX_CHUNKS_PER_BATCH: 500,
  MAX_EMBEDDING_BATCH: env.KB_CONFIG_BATCH_SIZE || 2000,
  MAX_FILE_SIZE: 100 * 1024 * 1024,
  MAX_CHUNKS_PER_DOCUMENT: 100000,
}

/**
 * Create a timeout wrapper for async operations
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation = 'Operation'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])
}

const PROCESSING_CONFIG = {
  maxConcurrentDocuments: Math.max(1, Math.floor((env.KB_CONFIG_CONCURRENCY_LIMIT || 20) / 5)) || 4,
  batchSize: Math.max(1, Math.floor((env.KB_CONFIG_BATCH_SIZE || 20) / 2)) || 10,
  delayBetweenBatches: (env.KB_CONFIG_DELAY_BETWEEN_BATCHES || 100) * 2,
  delayBetweenDocuments: (env.KB_CONFIG_DELAY_BETWEEN_DOCUMENTS || 50) * 2,
}

const REDIS_PROCESSING_CONFIG = {
  maxConcurrentDocuments: env.KB_CONFIG_CONCURRENCY_LIMIT || 20,
  batchSize: env.KB_CONFIG_BATCH_SIZE || 20,
  delayBetweenBatches: env.KB_CONFIG_DELAY_BETWEEN_BATCHES || 100,
  delayBetweenDocuments: env.KB_CONFIG_DELAY_BETWEEN_DOCUMENTS || 50,
}

let documentQueue: DocumentProcessingQueue | null = null

export function getDocumentQueue(): DocumentProcessingQueue {
  if (!documentQueue) {
    const config = isRedisStorage() ? REDIS_PROCESSING_CONFIG : PROCESSING_CONFIG
    documentQueue = new DocumentProcessingQueue({
      maxConcurrent: config.maxConcurrentDocuments,
      retryDelay: env.KB_CONFIG_MIN_TIMEOUT || 1000,
      maxRetries: env.KB_CONFIG_MAX_ATTEMPTS || 3,
    })
  }
  return documentQueue
}

export function getProcessingConfig() {
  return isRedisStorage() ? REDIS_PROCESSING_CONFIG : PROCESSING_CONFIG
}

export interface DocumentData {
  documentId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
}

export interface ProcessingOptions {
  chunkSize: number
  minCharactersPerChunk: number
  recipe: string
  lang: string
  chunkOverlap: number
}

export interface DocumentJobData {
  knowledgeBaseId: string
  documentId: string
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  }
  processingOptions: ProcessingOptions
  requestId: string
}

export interface DocumentTagData {
  tagName: string
  fieldType: string
  value: string
}

/**
 * Process structured document tags and validate them against existing definitions
 * Throws an error if a tag doesn't exist or if the value doesn't match the expected type
 */
export async function processDocumentTags(
  knowledgeBaseId: string,
  tagData: DocumentTagData[],
  requestId: string
): Promise<ProcessedDocumentTags> {
  const setTagValue = (
    tags: ProcessedDocumentTags,
    slot: string,
    value: string | number | Date | boolean | null
  ): void => {
    switch (slot) {
      case 'tag1':
        tags.tag1 = value as string | null
        break
      case 'tag2':
        tags.tag2 = value as string | null
        break
      case 'tag3':
        tags.tag3 = value as string | null
        break
      case 'tag4':
        tags.tag4 = value as string | null
        break
      case 'tag5':
        tags.tag5 = value as string | null
        break
      case 'tag6':
        tags.tag6 = value as string | null
        break
      case 'tag7':
        tags.tag7 = value as string | null
        break
      case 'number1':
        tags.number1 = value as number | null
        break
      case 'number2':
        tags.number2 = value as number | null
        break
      case 'number3':
        tags.number3 = value as number | null
        break
      case 'number4':
        tags.number4 = value as number | null
        break
      case 'number5':
        tags.number5 = value as number | null
        break
      case 'date1':
        tags.date1 = value as Date | null
        break
      case 'date2':
        tags.date2 = value as Date | null
        break
      case 'boolean1':
        tags.boolean1 = value as boolean | null
        break
      case 'boolean2':
        tags.boolean2 = value as boolean | null
        break
      case 'boolean3':
        tags.boolean3 = value as boolean | null
        break
    }
  }

  const result: ProcessedDocumentTags = {
    tag1: null,
    tag2: null,
    tag3: null,
    tag4: null,
    tag5: null,
    tag6: null,
    tag7: null,
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    number5: null,
    date1: null,
    date2: null,
    boolean1: null,
    boolean2: null,
    boolean3: null,
  }

  if (!Array.isArray(tagData) || tagData.length === 0) {
    return result
  }

  const existingDefinitions = await db
    .select()
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

  const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))

  const undefinedTags: string[] = []
  const typeErrors: string[] = []

  for (const tag of tagData) {
    if (!tag.tagName?.trim()) continue

    const tagName = tag.tagName.trim()
    const fieldType = tag.fieldType || 'text'

    const hasValue =
      fieldType === 'boolean'
        ? tag.value !== undefined && tag.value !== null && tag.value !== ''
        : tag.value?.trim && tag.value.trim().length > 0

    if (!hasValue) continue

    const existingDef = existingByName.get(tagName)
    if (!existingDef) {
      undefinedTags.push(tagName)
      continue
    }

    const rawValue = typeof tag.value === 'string' ? tag.value.trim() : tag.value
    const actualFieldType = existingDef.fieldType || fieldType
    const validationError = validateTagValue(tagName, String(rawValue), actualFieldType)
    if (validationError) {
      typeErrors.push(validationError)
    }
  }

  if (undefinedTags.length > 0 || typeErrors.length > 0) {
    const errorParts: string[] = []

    if (undefinedTags.length > 0) {
      errorParts.push(buildUndefinedTagsError(undefinedTags))
    }

    if (typeErrors.length > 0) {
      errorParts.push(...typeErrors)
    }

    throw new Error(errorParts.join('\n'))
  }

  for (const tag of tagData) {
    if (!tag.tagName?.trim()) continue

    const tagName = tag.tagName.trim()
    const fieldType = tag.fieldType || 'text'

    const hasValue =
      fieldType === 'boolean'
        ? tag.value !== undefined && tag.value !== null && tag.value !== ''
        : tag.value?.trim && tag.value.trim().length > 0

    if (!hasValue) continue

    const existingDef = existingByName.get(tagName)
    if (!existingDef) continue

    const targetSlot = existingDef.tagSlot
    const actualFieldType = existingDef.fieldType || fieldType
    const rawValue = typeof tag.value === 'string' ? tag.value.trim() : tag.value
    const stringValue = String(rawValue).trim()

    if (actualFieldType === 'boolean') {
      setTagValue(result, targetSlot, parseBooleanValue(stringValue) ?? false)
    } else if (actualFieldType === 'number') {
      setTagValue(result, targetSlot, parseNumberValue(stringValue))
    } else if (actualFieldType === 'date') {
      setTagValue(result, targetSlot, parseDateValue(stringValue))
    } else {
      setTagValue(result, targetSlot, stringValue)
    }

    logger.info(`[${requestId}] Set tag ${tagName} (${targetSlot}) = ${stringValue}`)
  }

  return result
}

/**
 * Process documents with best available method: Trigger.dev > Redis queue > in-memory concurrency control
 */
export async function processDocumentsWithQueue(
  createdDocuments: DocumentData[],
  knowledgeBaseId: string,
  processingOptions: ProcessingOptions,
  requestId: string
): Promise<void> {
  // Priority 1: Trigger.dev
  if (isTriggerAvailable()) {
    try {
      logger.info(
        `[${requestId}] Using Trigger.dev background processing for ${createdDocuments.length} documents`
      )

      const triggerPayloads = createdDocuments.map((doc) => ({
        knowledgeBaseId,
        documentId: doc.documentId,
        docData: {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        },
        processingOptions,
        requestId,
      }))

      const result = await processDocumentsWithTrigger(triggerPayloads, requestId)

      if (result.success) {
        logger.info(
          `[${requestId}] Successfully triggered background processing: ${result.message}`
        )
        return
      }
      logger.warn(`[${requestId}] Trigger.dev failed: ${result.message}, falling back to Redis`)
    } catch (error) {
      logger.warn(`[${requestId}] Trigger.dev processing failed, falling back to Redis:`, error)
    }
  }

  // Priority 2: Queue-based processing (Redis or in-memory based on storage method)
  const queue = getDocumentQueue()
  const storageMethod = getStorageMethod()

  logger.info(
    `[${requestId}] Using ${storageMethod} queue for ${createdDocuments.length} documents`
  )

  const jobPromises = createdDocuments.map((doc) =>
    queue.addJob<DocumentJobData>('process-document', {
      knowledgeBaseId,
      documentId: doc.documentId,
      docData: {
        filename: doc.filename,
        fileUrl: doc.fileUrl,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
      },
      processingOptions,
      requestId,
    })
  )

  await Promise.all(jobPromises)

  queue
    .processJobs(async (job) => {
      const data = job.data as DocumentJobData
      const { knowledgeBaseId, documentId, docData, processingOptions } = data
      await processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions)
    })
    .catch((error) => {
      logger.error(`[${requestId}] Error in queue processing:`, error)
    })

  logger.info(`[${requestId}] All documents queued for processing`)
  return
}

/**
 * Process a document asynchronously with full error handling
 */
export async function processDocumentAsync(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  processingOptions: {
    chunkSize?: number
    minCharactersPerChunk?: number
    recipe?: string
    lang?: string
    chunkOverlap?: number
  }
): Promise<void> {
  const startTime = Date.now()
  try {
    logger.info(`[${documentId}] Starting document processing: ${docData.filename}`)

    const kb = await db
      .select({
        userId: knowledgeBase.userId,
        workspaceId: knowledgeBase.workspaceId,
        chunkingConfig: knowledgeBase.chunkingConfig,
      })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, knowledgeBaseId))
      .limit(1)

    if (kb.length === 0) {
      throw new Error(`Knowledge base not found: ${knowledgeBaseId}`)
    }

    await db
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt: new Date(),
        processingError: null,
      })
      .where(eq(document.id, documentId))

    logger.info(`[${documentId}] Status updated to 'processing', starting document processor`)

    const kbConfig = kb[0].chunkingConfig as { maxSize: number; minSize: number; overlap: number }

    await withTimeout(
      (async () => {
        const processed = await processDocument(
          docData.fileUrl,
          docData.filename,
          docData.mimeType,
          processingOptions.chunkSize ?? kbConfig.maxSize,
          processingOptions.chunkOverlap ?? kbConfig.overlap,
          processingOptions.minCharactersPerChunk ?? kbConfig.minSize,
          kb[0].userId,
          kb[0].workspaceId
        )

        if (processed.chunks.length > LARGE_DOC_CONFIG.MAX_CHUNKS_PER_DOCUMENT) {
          throw new Error(
            `Document has ${processed.chunks.length.toLocaleString()} chunks, exceeding maximum of ${LARGE_DOC_CONFIG.MAX_CHUNKS_PER_DOCUMENT.toLocaleString()}. ` +
              `This document is unusually large and may need to be split into multiple files or preprocessed to reduce content.`
          )
        }

        const now = new Date()

        logger.info(
          `[${documentId}] Document parsed successfully, generating embeddings for ${processed.chunks.length} chunks`
        )

        const chunkTexts = processed.chunks.map((chunk) => chunk.text)
        const embeddings: number[][] = []

        if (chunkTexts.length > 0) {
          const batchSize = LARGE_DOC_CONFIG.MAX_EMBEDDING_BATCH
          const totalBatches = Math.ceil(chunkTexts.length / batchSize)

          logger.info(`[${documentId}] Generating embeddings in ${totalBatches} batches`)

          for (let i = 0; i < chunkTexts.length; i += batchSize) {
            const batch = chunkTexts.slice(i, i + batchSize)
            const batchNum = Math.floor(i / batchSize) + 1

            logger.info(`[${documentId}] Processing embedding batch ${batchNum}/${totalBatches}`)
            const batchEmbeddings = await generateEmbeddings(batch, undefined, kb[0].workspaceId)
            for (const emb of batchEmbeddings) {
              embeddings.push(emb)
            }
          }
        }

        logger.info(`[${documentId}] Embeddings generated, fetching document tags`)

        const documentRecord = await db
          .select({
            // Text tags (7 slots)
            tag1: document.tag1,
            tag2: document.tag2,
            tag3: document.tag3,
            tag4: document.tag4,
            tag5: document.tag5,
            tag6: document.tag6,
            tag7: document.tag7,
            // Number tags (5 slots)
            number1: document.number1,
            number2: document.number2,
            number3: document.number3,
            number4: document.number4,
            number5: document.number5,
            // Date tags (2 slots)
            date1: document.date1,
            date2: document.date2,
            // Boolean tags (3 slots)
            boolean1: document.boolean1,
            boolean2: document.boolean2,
            boolean3: document.boolean3,
          })
          .from(document)
          .where(eq(document.id, documentId))
          .limit(1)

        const documentTags = documentRecord[0] || {}

        logger.info(`[${documentId}] Creating embedding records with tags`)

        const embeddingRecords = processed.chunks.map((chunk, chunkIndex) => ({
          id: crypto.randomUUID(),
          knowledgeBaseId,
          documentId,
          chunkIndex,
          chunkHash: crypto.createHash('sha256').update(chunk.text).digest('hex'),
          content: chunk.text,
          contentLength: chunk.text.length,
          tokenCount: Math.ceil(chunk.text.length / 4),
          embedding: embeddings[chunkIndex] || null,
          embeddingModel: 'text-embedding-3-small',
          startOffset: chunk.metadata.startIndex,
          endOffset: chunk.metadata.endIndex,
          // Copy text tags from document (7 slots)
          tag1: documentTags.tag1,
          tag2: documentTags.tag2,
          tag3: documentTags.tag3,
          tag4: documentTags.tag4,
          tag5: documentTags.tag5,
          tag6: documentTags.tag6,
          tag7: documentTags.tag7,
          // Copy number tags from document (5 slots)
          number1: documentTags.number1,
          number2: documentTags.number2,
          number3: documentTags.number3,
          number4: documentTags.number4,
          number5: documentTags.number5,
          // Copy date tags from document (2 slots)
          date1: documentTags.date1,
          date2: documentTags.date2,
          // Copy boolean tags from document (3 slots)
          boolean1: documentTags.boolean1,
          boolean2: documentTags.boolean2,
          boolean3: documentTags.boolean3,
          createdAt: now,
          updatedAt: now,
        }))

        await db.transaction(async (tx) => {
          if (embeddingRecords.length > 0) {
            await tx.delete(embedding).where(eq(embedding.documentId, documentId))

            const insertBatchSize = LARGE_DOC_CONFIG.MAX_CHUNKS_PER_BATCH
            const batches: (typeof embeddingRecords)[] = []
            for (let i = 0; i < embeddingRecords.length; i += insertBatchSize) {
              batches.push(embeddingRecords.slice(i, i + insertBatchSize))
            }

            logger.info(`[${documentId}] Inserting ${embeddingRecords.length} embeddings`)
            for (const batch of batches) {
              await tx.insert(embedding).values(batch)
            }
          }

          await tx
            .update(document)
            .set({
              chunkCount: processed.metadata.chunkCount,
              tokenCount: processed.metadata.tokenCount,
              characterCount: processed.metadata.characterCount,
              processingStatus: 'completed',
              processingCompletedAt: now,
              processingError: null,
            })
            .where(eq(document.id, documentId))
        })
      })(),
      TIMEOUTS.OVERALL_PROCESSING,
      'Document processing'
    )

    const processingTime = Date.now() - startTime
    logger.info(`[${documentId}] Successfully processed document in ${processingTime}ms`)
  } catch (error) {
    const processingTime = Date.now() - startTime
    logger.error(`[${documentId}] Failed to process document after ${processingTime}ms:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      filename: docData.filename,
      fileUrl: docData.fileUrl,
      mimeType: docData.mimeType,
    })

    await db
      .update(document)
      .set({
        processingStatus: 'failed',
        processingError: error instanceof Error ? error.message : 'Unknown error',
        processingCompletedAt: new Date(),
      })
      .where(eq(document.id, documentId))
  }
}

/**
 * Check if Trigger.dev is available and configured
 */
export function isTriggerAvailable(): boolean {
  return !!(env.TRIGGER_SECRET_KEY && env.TRIGGER_DEV_ENABLED !== false)
}

/**
 * Process documents using Trigger.dev
 */
export async function processDocumentsWithTrigger(
  documents: DocumentProcessingPayload[],
  requestId: string
): Promise<{ success: boolean; message: string; jobIds?: string[] }> {
  if (!isTriggerAvailable()) {
    throw new Error('Trigger.dev is not configured - TRIGGER_SECRET_KEY missing')
  }

  try {
    logger.info(`[${requestId}] Triggering background processing for ${documents.length} documents`)

    const jobPromises = documents.map(async (document) => {
      const job = await tasks.trigger('knowledge-process-document', document)
      return job.id
    })

    const jobIds = await Promise.all(jobPromises)

    logger.info(`[${requestId}] Triggered ${jobIds.length} document processing jobs`)

    return {
      success: true,
      message: `${documents.length} document processing jobs triggered`,
      jobIds,
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to trigger document processing jobs:`, error)

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to trigger background jobs',
    }
  }
}

/**
 * Create document records in database with tags
 */
export async function createDocumentRecords(
  documents: Array<{
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  }>,
  knowledgeBaseId: string,
  requestId: string
): Promise<DocumentData[]> {
  const kb = await db
    .select({ userId: knowledgeBase.userId })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  if (kb.length === 0) {
    throw new Error('Knowledge base not found')
  }

  return await db.transaction(async (tx) => {
    const now = new Date()
    const documentRecords = []
    const returnData: DocumentData[] = []

    for (const docData of documents) {
      const documentId = randomUUID()

      let processedTags: Partial<ProcessedDocumentTags> = {}

      if (docData.documentTagsData) {
        try {
          const tagData = JSON.parse(docData.documentTagsData)
          if (Array.isArray(tagData)) {
            processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.warn(`[${requestId}] Failed to parse documentTagsData for bulk document:`, error)
          } else {
            throw error
          }
        }
      }

      const newDocument = {
        id: documentId,
        knowledgeBaseId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        processingStatus: 'pending' as const,
        enabled: true,
        uploadedAt: now,
        // Text tags - use processed tags if available, otherwise fall back to individual tag fields
        tag1: processedTags.tag1 ?? docData.tag1 ?? null,
        tag2: processedTags.tag2 ?? docData.tag2 ?? null,
        tag3: processedTags.tag3 ?? docData.tag3 ?? null,
        tag4: processedTags.tag4 ?? docData.tag4 ?? null,
        tag5: processedTags.tag5 ?? docData.tag5 ?? null,
        tag6: processedTags.tag6 ?? docData.tag6 ?? null,
        tag7: processedTags.tag7 ?? docData.tag7 ?? null,
        // Number tags (5 slots)
        number1: processedTags.number1 ?? null,
        number2: processedTags.number2 ?? null,
        number3: processedTags.number3 ?? null,
        number4: processedTags.number4 ?? null,
        number5: processedTags.number5 ?? null,
        // Date tags (2 slots)
        date1: processedTags.date1 ?? null,
        date2: processedTags.date2 ?? null,
        // Boolean tags (3 slots)
        boolean1: processedTags.boolean1 ?? null,
        boolean2: processedTags.boolean2 ?? null,
        boolean3: processedTags.boolean3 ?? null,
      }

      documentRecords.push(newDocument)
      returnData.push({
        documentId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
      })
    }

    if (documentRecords.length > 0) {
      await tx.insert(document).values(documentRecords)
      logger.info(
        `[${requestId}] Bulk created ${documentRecords.length} document records in knowledge base ${knowledgeBaseId}`
      )

      await tx
        .update(knowledgeBase)
        .set({ updatedAt: now })
        .where(eq(knowledgeBase.id, knowledgeBaseId))
    }

    return returnData
  })
}

/**
 * Get documents for a knowledge base with filtering and pagination
 */
export async function getDocuments(
  knowledgeBaseId: string,
  options: {
    enabledFilter?: 'all' | 'enabled' | 'disabled'
    search?: string
    limit?: number
    offset?: number
    sortBy?: DocumentSortField
    sortOrder?: SortOrder
  },
  requestId: string
): Promise<{
  documents: Array<{
    id: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    processingStartedAt: Date | null
    processingCompletedAt: Date | null
    processingError: string | null
    enabled: boolean
    uploadedAt: Date
    // Text tags
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
    // Number tags
    number1: number | null
    number2: number | null
    number3: number | null
    number4: number | null
    number5: number | null
    // Date tags
    date1: Date | null
    date2: Date | null
    // Boolean tags
    boolean1: boolean | null
    boolean2: boolean | null
    boolean3: boolean | null
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}> {
  const {
    enabledFilter = 'all',
    search,
    limit = 50,
    offset = 0,
    sortBy = 'filename',
    sortOrder = 'asc',
  } = options

  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
  ]

  if (enabledFilter === 'enabled') {
    whereConditions.push(eq(document.enabled, true))
  } else if (enabledFilter === 'disabled') {
    whereConditions.push(eq(document.enabled, false))
  }

  if (search) {
    whereConditions.push(sql`LOWER(${document.filename}) LIKE LOWER(${`%${search}%`})`)
  }

  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(document)
    .where(and(...whereConditions))

  const total = totalResult[0]?.count || 0
  const hasMore = offset + limit < total

  const getOrderByColumn = () => {
    switch (sortBy) {
      case 'filename':
        return document.filename
      case 'fileSize':
        return document.fileSize
      case 'tokenCount':
        return document.tokenCount
      case 'chunkCount':
        return document.chunkCount
      case 'uploadedAt':
        return document.uploadedAt
      case 'processingStatus':
        return document.processingStatus
      case 'enabled':
        return document.enabled
      default:
        return document.uploadedAt
    }
  }

  const primaryOrderBy = sortOrder === 'asc' ? asc(getOrderByColumn()) : desc(getOrderByColumn())
  const secondaryOrderBy =
    sortBy === 'filename' ? desc(document.uploadedAt) : asc(document.filename)

  const documents = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      processingStatus: document.processingStatus,
      processingStartedAt: document.processingStartedAt,
      processingCompletedAt: document.processingCompletedAt,
      processingError: document.processingError,
      enabled: document.enabled,
      uploadedAt: document.uploadedAt,
      // Text tags (7 slots)
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
      // Number tags (5 slots)
      number1: document.number1,
      number2: document.number2,
      number3: document.number3,
      number4: document.number4,
      number5: document.number5,
      // Date tags (2 slots)
      date1: document.date1,
      date2: document.date2,
      // Boolean tags (3 slots)
      boolean1: document.boolean1,
      boolean2: document.boolean2,
      boolean3: document.boolean3,
    })
    .from(document)
    .where(and(...whereConditions))
    .orderBy(primaryOrderBy, secondaryOrderBy)
    .limit(limit)
    .offset(offset)

  logger.info(
    `[${requestId}] Retrieved ${documents.length} documents (${offset}-${offset + documents.length} of ${total}) for knowledge base ${knowledgeBaseId}`
  )

  return {
    documents: documents.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      chunkCount: doc.chunkCount,
      tokenCount: doc.tokenCount,
      characterCount: doc.characterCount,
      processingStatus: doc.processingStatus as 'pending' | 'processing' | 'completed' | 'failed',
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt,
      processingError: doc.processingError,
      enabled: doc.enabled,
      uploadedAt: doc.uploadedAt,
      // Text tags
      tag1: doc.tag1,
      tag2: doc.tag2,
      tag3: doc.tag3,
      tag4: doc.tag4,
      tag5: doc.tag5,
      tag6: doc.tag6,
      tag7: doc.tag7,
      // Number tags
      number1: doc.number1,
      number2: doc.number2,
      number3: doc.number3,
      number4: doc.number4,
      number5: doc.number5,
      // Date tags
      date1: doc.date1,
      date2: doc.date2,
      // Boolean tags
      boolean1: doc.boolean1,
      boolean2: doc.boolean2,
      boolean3: doc.boolean3,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore,
    },
  }
}

/**
 * Create a single document record
 */
export async function createSingleDocument(
  documentData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  },
  knowledgeBaseId: string,
  requestId: string
): Promise<{
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  uploadedAt: Date
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
}> {
  const kb = await db
    .select({ userId: knowledgeBase.userId })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  if (kb.length === 0) {
    throw new Error('Knowledge base not found')
  }

  const documentId = randomUUID()
  const now = new Date()

  let processedTags: ProcessedDocumentTags = {
    // Text tags (7 slots)
    tag1: documentData.tag1 ?? null,
    tag2: documentData.tag2 ?? null,
    tag3: documentData.tag3 ?? null,
    tag4: documentData.tag4 ?? null,
    tag5: documentData.tag5 ?? null,
    tag6: documentData.tag6 ?? null,
    tag7: documentData.tag7 ?? null,
    // Number tags (5 slots)
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    number5: null,
    // Date tags (2 slots)
    date1: null,
    date2: null,
    // Boolean tags (3 slots)
    boolean1: null,
    boolean2: null,
    boolean3: null,
  }

  if (documentData.documentTagsData) {
    try {
      const tagData = JSON.parse(documentData.documentTagsData)
      if (Array.isArray(tagData)) {
        processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.warn(`[${requestId}] Failed to parse documentTagsData:`, error)
      } else {
        throw error
      }
    }
  }

  const newDocument = {
    id: documentId,
    knowledgeBaseId,
    filename: documentData.filename,
    fileUrl: documentData.fileUrl,
    fileSize: documentData.fileSize,
    mimeType: documentData.mimeType,
    chunkCount: 0,
    tokenCount: 0,
    characterCount: 0,
    enabled: true,
    uploadedAt: now,
    ...processedTags,
  }

  await db.insert(document).values(newDocument)

  await db
    .update(knowledgeBase)
    .set({ updatedAt: now })
    .where(eq(knowledgeBase.id, knowledgeBaseId))

  logger.info(`[${requestId}] Document created: ${documentId} in knowledge base ${knowledgeBaseId}`)

  return newDocument as {
    id: string
    knowledgeBaseId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    enabled: boolean
    uploadedAt: Date
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
  }
}

/**
 * Perform bulk operations on documents
 */
export async function bulkDocumentOperation(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  documentIds: string[],
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
    processingStatus?: string
  }>
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on ${documentIds.length} documents in knowledge base ${knowledgeBaseId}`
  )

  const documentsToUpdate = await db
    .select({
      id: document.id,
      enabled: document.enabled,
    })
    .from(document)
    .where(
      and(
        eq(document.knowledgeBaseId, knowledgeBaseId),
        inArray(document.id, documentIds),
        isNull(document.deletedAt)
      )
    )

  if (documentsToUpdate.length === 0) {
    throw new Error('No valid documents found to update')
  }

  if (documentsToUpdate.length !== documentIds.length) {
    logger.warn(
      `[${requestId}] Some documents not found or don't belong to knowledge base. Requested: ${documentIds.length}, Found: ${documentsToUpdate.length}`
    )
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
    processingStatus?: string
  }>

  if (operation === 'delete') {
    updateResult = await db
      .update(document)
      .set({
        deletedAt: new Date(),
      })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          inArray(document.id, documentIds),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id, deletedAt: document.deletedAt })
  } else {
    const enabled = operation === 'enable'

    updateResult = await db
      .update(document)
      .set({
        enabled,
      })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          inArray(document.id, documentIds),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} operation completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return {
    success: true,
    successCount,
    updatedDocuments: updateResult,
  }
}

/**
 * Perform bulk operations on all documents matching a filter
 */
export async function bulkDocumentOperationByFilter(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  enabledFilter: 'all' | 'enabled' | 'disabled' | undefined,
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on all documents (filter: ${enabledFilter || 'all'}) in knowledge base ${knowledgeBaseId}`
  )

  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
  ]

  if (enabledFilter === 'enabled') {
    whereConditions.push(eq(document.enabled, true))
  } else if (enabledFilter === 'disabled') {
    whereConditions.push(eq(document.enabled, false))
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>

  if (operation === 'delete') {
    updateResult = await db
      .update(document)
      .set({
        deletedAt: new Date(),
      })
      .where(and(...whereConditions))
      .returning({ id: document.id, deletedAt: document.deletedAt })
  } else {
    const enabled = operation === 'enable'

    updateResult = await db
      .update(document)
      .set({
        enabled,
      })
      .where(and(...whereConditions))
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} by filter completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return {
    success: true,
    successCount,
    updatedDocuments: updateResult,
  }
}

/**
 * Mark a document as failed due to timeout
 */
export async function markDocumentAsFailedTimeout(
  documentId: string,
  processingStartedAt: Date,
  requestId: string
): Promise<{ success: boolean; processingDuration: number }> {
  const now = new Date()
  const processingDuration = now.getTime() - processingStartedAt.getTime()
  const DEAD_PROCESS_THRESHOLD_MS = 600 * 1000 // 10 minutes

  if (processingDuration <= DEAD_PROCESS_THRESHOLD_MS) {
    throw new Error('Document has not been processing long enough to be considered dead')
  }

  await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingError: 'Processing timed out - background process may have been terminated',
      processingCompletedAt: now,
    })
    .where(eq(document.id, documentId))

  logger.info(
    `[${requestId}] Marked document ${documentId} as failed due to dead process (processing time: ${Math.round(processingDuration / 1000)}s)`
  )

  return {
    success: true,
    processingDuration,
  }
}

/**
 * Retry processing a failed document
 */
export async function retryDocumentProcessing(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  requestId: string
): Promise<{ success: boolean; status: string; message: string }> {
  const kb = await db
    .select({
      chunkingConfig: knowledgeBase.chunkingConfig,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  const kbConfig = kb[0].chunkingConfig as { maxSize: number; minSize: number; overlap: number }

  await db.transaction(async (tx) => {
    await tx.delete(embedding).where(eq(embedding.documentId, documentId))

    await tx
      .update(document)
      .set({
        processingStatus: 'pending',
        processingStartedAt: null,
        processingCompletedAt: null,
        processingError: null,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
      })
      .where(eq(document.id, documentId))
  })

  const processingOptions = {
    chunkSize: kbConfig.maxSize,
    minCharactersPerChunk: kbConfig.minSize,
    recipe: 'default',
    lang: 'en',
    chunkOverlap: kbConfig.overlap,
  }

  processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions).catch(
    (error: unknown) => {
      logger.error(`[${requestId}] Background retry processing error:`, error)
    }
  )

  logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

  return {
    success: true,
    status: 'pending',
    message: 'Document retry processing started',
  }
}

/**
 * Update a document with specified fields
 */
export async function updateDocument(
  documentId: string,
  updateData: {
    filename?: string
    enabled?: boolean
    chunkCount?: number
    tokenCount?: number
    characterCount?: number
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    processingError?: string
    // Text tags
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
    // Number tags
    number1?: string
    number2?: string
    number3?: string
    number4?: string
    number5?: string
    // Date tags
    date1?: string
    date2?: string
    // Boolean tags
    boolean1?: string
    boolean2?: string
    boolean3?: string
  },
  requestId: string
): Promise<{
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingError: string | null
  enabled: boolean
  uploadedAt: Date
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  date1: Date | null
  date2: Date | null
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  deletedAt: Date | null
}> {
  const dbUpdateData: Partial<{
    filename: string
    enabled: boolean
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    processingError: string | null
    processingStartedAt: Date | null
    processingCompletedAt: Date | null
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
    number1: number | null
    number2: number | null
    number3: number | null
    number4: number | null
    number5: number | null
    date1: Date | null
    date2: Date | null
    boolean1: boolean | null
    boolean2: boolean | null
    boolean3: boolean | null
  }> = {}
  // All tag slots across all field types
  const ALL_TAG_SLOTS = [
    'tag1',
    'tag2',
    'tag3',
    'tag4',
    'tag5',
    'tag6',
    'tag7',
    'number1',
    'number2',
    'number3',
    'number4',
    'number5',
    'date1',
    'date2',
    'boolean1',
    'boolean2',
    'boolean3',
  ] as const
  type TagSlot = (typeof ALL_TAG_SLOTS)[number]

  // Regular field updates
  if (updateData.filename !== undefined) dbUpdateData.filename = updateData.filename
  if (updateData.enabled !== undefined) dbUpdateData.enabled = updateData.enabled
  if (updateData.chunkCount !== undefined) dbUpdateData.chunkCount = updateData.chunkCount
  if (updateData.tokenCount !== undefined) dbUpdateData.tokenCount = updateData.tokenCount
  if (updateData.characterCount !== undefined)
    dbUpdateData.characterCount = updateData.characterCount
  if (updateData.processingStatus !== undefined)
    dbUpdateData.processingStatus = updateData.processingStatus
  if (updateData.processingError !== undefined)
    dbUpdateData.processingError = updateData.processingError

  const convertTagValue = (
    slot: string,
    value: string | undefined
  ): string | number | Date | boolean | null => {
    if (value === undefined || value === '') return null

    // Number slots
    if (slot.startsWith('number')) {
      return parseNumberValue(value)
    }

    // Date slots
    if (slot.startsWith('date')) {
      return parseDateValue(value)
    }

    // Boolean slots
    if (slot.startsWith('boolean')) {
      return parseBooleanValue(value) ?? false
    }

    // Text slots: keep as string
    return value || null
  }

  // Type-safe access to tag slots in updateData
  type UpdateDataWithTags = typeof updateData & Record<TagSlot, string | undefined>
  const typedUpdateData = updateData as UpdateDataWithTags

  ALL_TAG_SLOTS.forEach((slot: TagSlot) => {
    const updateValue = typedUpdateData[slot]
    if (updateValue !== undefined) {
      ;(dbUpdateData as Record<TagSlot, string | number | Date | boolean | null>)[slot] =
        convertTagValue(slot, updateValue)
    }
  })

  await db.transaction(async (tx) => {
    await tx.update(document).set(dbUpdateData).where(eq(document.id, documentId))

    const hasTagUpdates = ALL_TAG_SLOTS.some((field) => typedUpdateData[field] !== undefined)

    if (hasTagUpdates) {
      const embeddingUpdateData: Partial<ProcessedDocumentTags> = {}
      ALL_TAG_SLOTS.forEach((field) => {
        if (typedUpdateData[field] !== undefined) {
          ;(embeddingUpdateData as Record<TagSlot, string | number | Date | boolean | null>)[
            field
          ] = convertTagValue(field, typedUpdateData[field])
        }
      })

      await tx
        .update(embedding)
        .set(embeddingUpdateData)
        .where(eq(embedding.documentId, documentId))
    }
  })

  const updatedDocument = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId))
    .limit(1)

  if (updatedDocument.length === 0) {
    throw new Error(`Document ${documentId} not found`)
  }

  logger.info(`[${requestId}] Document updated: ${documentId}`)

  const doc = updatedDocument[0]
  return {
    id: doc.id,
    knowledgeBaseId: doc.knowledgeBaseId,
    filename: doc.filename,
    fileUrl: doc.fileUrl,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    chunkCount: doc.chunkCount,
    tokenCount: doc.tokenCount,
    characterCount: doc.characterCount,
    processingStatus: doc.processingStatus as 'pending' | 'processing' | 'completed' | 'failed',
    processingStartedAt: doc.processingStartedAt,
    processingCompletedAt: doc.processingCompletedAt,
    processingError: doc.processingError,
    enabled: doc.enabled,
    uploadedAt: doc.uploadedAt,
    tag1: doc.tag1,
    tag2: doc.tag2,
    tag3: doc.tag3,
    tag4: doc.tag4,
    tag5: doc.tag5,
    tag6: doc.tag6,
    tag7: doc.tag7,
    number1: doc.number1,
    number2: doc.number2,
    number3: doc.number3,
    number4: doc.number4,
    number5: doc.number5,
    date1: doc.date1,
    date2: doc.date2,
    boolean1: doc.boolean1,
    boolean2: doc.boolean2,
    boolean3: doc.boolean3,
    deletedAt: doc.deletedAt,
  }
}

/**
 * Soft delete a document
 */
export async function deleteDocument(
  documentId: string,
  requestId: string
): Promise<{ success: boolean; message: string }> {
  await db
    .update(document)
    .set({
      deletedAt: new Date(),
    })
    .where(eq(document.id, documentId))

  logger.info(`[${requestId}] Document deleted: ${documentId}`)

  return {
    success: true,
    message: 'Document deleted successfully',
  }
}
