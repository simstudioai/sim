import crypto, { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { document, embedding, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { generateEmbeddings } from '@/lib/embeddings/utils'
import { env } from '@/lib/env'
import { getSlotsForFieldType, type TAG_SLOT_CONFIG } from '@/lib/knowledge/consts'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { getNextAvailableSlot } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'
import type { DocumentProcessingPayload } from '@/background/knowledge-processing'
import { DocumentProcessingQueue } from './queue'
import type { DocumentSortField, SortOrder } from './types'

const logger = createLogger('DocumentService')

const TIMEOUTS = {
  OVERALL_PROCESSING: (env.KB_CONFIG_MAX_DURATION || 600) * 1000, // Default 10 minutes for KB document processing
  EMBEDDINGS_API: (env.KB_CONFIG_MAX_TIMEOUT || 10000) * 18,
} as const

// Configuration for handling large documents
const LARGE_DOC_CONFIG = {
  MAX_CHUNKS_PER_BATCH: 500, // Insert embeddings in batches of 500
  MAX_EMBEDDING_BATCH: 500, // Generate embeddings in batches of 500
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB max file size
  MAX_CHUNKS_PER_DOCUMENT: 100000, // Maximum chunks allowed per document
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
    const redisClient = getRedisClient()
    const config = redisClient ? REDIS_PROCESSING_CONFIG : PROCESSING_CONFIG
    documentQueue = new DocumentProcessingQueue({
      maxConcurrent: config.maxConcurrentDocuments,
      retryDelay: env.KB_CONFIG_MIN_TIMEOUT || 1000,
      maxRetries: env.KB_CONFIG_MAX_ATTEMPTS || 3,
    })
  }
  return documentQueue
}

export function getProcessingConfig() {
  const redisClient = getRedisClient()
  return redisClient ? REDIS_PROCESSING_CONFIG : PROCESSING_CONFIG
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
 * Process structured document tags and create tag definitions
 */
export async function processDocumentTags(
  knowledgeBaseId: string,
  tagData: DocumentTagData[],
  requestId: string
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}

  const textSlots = getSlotsForFieldType('text')
  textSlots.forEach((slot) => {
    result[slot] = null
  })

  if (!Array.isArray(tagData) || tagData.length === 0) {
    return result
  }

  try {
    const existingDefinitions = await db
      .select()
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))

    const existingByName = new Map(existingDefinitions.map((def) => [def.displayName, def]))
    const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot as string, def]))

    for (const tag of tagData) {
      if (!tag.tagName?.trim() || !tag.value?.trim()) continue

      const tagName = tag.tagName.trim()
      const fieldType = tag.fieldType
      const value = tag.value.trim()

      let targetSlot: string | null = null

      // Check if tag definition already exists
      const existingDef = existingByName.get(tagName)
      if (existingDef) {
        targetSlot = existingDef.tagSlot
      } else {
        // Find next available slot using the tags service function
        targetSlot = await getNextAvailableSlot(knowledgeBaseId, fieldType, existingBySlot)

        // Create new tag definition if we have a slot
        if (targetSlot) {
          const newDefinition = {
            id: randomUUID(),
            knowledgeBaseId,
            tagSlot: targetSlot as (typeof TAG_SLOT_CONFIG.text.slots)[number],
            displayName: tagName,
            fieldType,
            createdAt: new Date(),
            updatedAt: new Date(),
          }

          await db.insert(knowledgeBaseTagDefinitions).values(newDefinition)
          existingBySlot.set(targetSlot, newDefinition)

          logger.info(`[${requestId}] Created tag definition: ${tagName} -> ${targetSlot}`)
        }
      }

      // Assign value to the slot
      if (targetSlot) {
        result[targetSlot] = value
      }
    }

    return result
  } catch (error) {
    logger.error(`[${requestId}] Error processing document tags:`, error)
    return result
  }
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
        processingOptions: {
          chunkSize: processingOptions.chunkSize || 1024,
          minCharactersPerChunk: processingOptions.minCharactersPerChunk || 1,
          recipe: processingOptions.recipe || 'default',
          lang: processingOptions.lang || 'en',
          chunkOverlap: processingOptions.chunkOverlap || 200,
        },
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

  // Priority 2: Redis queue
  const queue = getDocumentQueue()
  const redisClient = getRedisClient()

  if (redisClient) {
    try {
      logger.info(`[${requestId}] Using Redis queue for ${createdDocuments.length} documents`)

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

      // Start Redis background processing
      queue
        .processJobs(async (job) => {
          const data = job.data as DocumentJobData
          const { knowledgeBaseId, documentId, docData, processingOptions } = data
          await processDocumentAsync(knowledgeBaseId, documentId, docData, processingOptions)
        })
        .catch((error) => {
          logger.error(`[${requestId}] Error in Redis queue processing:`, error)
        })

      logger.info(`[${requestId}] All documents queued for Redis processing`)
      return
    } catch (error) {
      logger.warn(`[${requestId}] Redis queue failed, falling back to in-memory processing:`, error)
    }
  }

  // Priority 3: In-memory processing
  logger.info(
    `[${requestId}] Using fallback in-memory processing (neither Trigger.dev nor Redis available)`
  )
  await processDocumentsWithConcurrencyControl(
    createdDocuments,
    knowledgeBaseId,
    processingOptions,
    requestId
  )
}

/**
 * Original concurrency control processing (fallback when Redis not available)
 */
async function processDocumentsWithConcurrencyControl(
  createdDocuments: DocumentData[],
  knowledgeBaseId: string,
  processingOptions: ProcessingOptions,
  requestId: string
): Promise<void> {
  const totalDocuments = createdDocuments.length
  const batches = []

  for (let i = 0; i < totalDocuments; i += PROCESSING_CONFIG.batchSize) {
    batches.push(createdDocuments.slice(i, i + PROCESSING_CONFIG.batchSize))
  }

  logger.info(`[${requestId}] Processing ${totalDocuments} documents in ${batches.length} batches`)

  for (const [batchIndex, batch] of batches.entries()) {
    logger.info(
      `[${requestId}] Starting batch ${batchIndex + 1}/${batches.length} with ${batch.length} documents`
    )

    await processBatchWithConcurrency(batch, knowledgeBaseId, processingOptions, requestId)

    if (batchIndex < batches.length - 1) {
      const config = getProcessingConfig()
      if (config.delayBetweenBatches > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.delayBetweenBatches))
      }
    }
  }

  logger.info(`[${requestId}] Completed processing initiation for all ${totalDocuments} documents`)
}

/**
 * Process a batch of documents with concurrency control using semaphore
 */
async function processBatchWithConcurrency(
  batch: DocumentData[],
  knowledgeBaseId: string,
  processingOptions: ProcessingOptions,
  requestId: string
): Promise<void> {
  const config = getProcessingConfig()
  const semaphore = new Array(config.maxConcurrentDocuments).fill(0)
  const processingPromises = batch.map(async (doc, index) => {
    if (index > 0 && config.delayBetweenDocuments > 0) {
      await new Promise((resolve) => setTimeout(resolve, index * config.delayBetweenDocuments))
    }

    await new Promise<void>((resolve) => {
      const checkSlot = () => {
        const availableIndex = semaphore.findIndex((slot) => slot === 0)
        if (availableIndex !== -1) {
          semaphore[availableIndex] = 1
          resolve()
        } else {
          setTimeout(checkSlot, 100)
        }
      }
      checkSlot()
    })

    try {
      logger.info(`[${requestId}] Starting processing for document: ${doc.filename}`)

      await processDocumentAsync(
        knowledgeBaseId,
        doc.documentId,
        {
          filename: doc.filename,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
        },
        processingOptions
      )

      logger.info(`[${requestId}] Successfully initiated processing for document: ${doc.filename}`)
    } catch (error: unknown) {
      logger.error(`[${requestId}] Failed to process document: ${doc.filename}`, {
        documentId: doc.documentId,
        filename: doc.filename,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      try {
        await db
          .update(document)
          .set({
            processingStatus: 'failed',
            processingError:
              error instanceof Error ? error.message : 'Failed to initiate processing',
            processingCompletedAt: new Date(),
          })
          .where(eq(document.id, doc.documentId))
      } catch (dbError: unknown) {
        logger.error(
          `[${requestId}] Failed to update document status for failed document: ${doc.documentId}`,
          dbError
        )
      }
    } finally {
      const slotIndex = semaphore.findIndex((slot) => slot === 1)
      if (slotIndex !== -1) {
        semaphore[slotIndex] = 0
      }
    }
  })

  await Promise.allSettled(processingPromises)
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

    await db
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt: new Date(),
        processingError: null,
      })
      .where(eq(document.id, documentId))

    logger.info(`[${documentId}] Status updated to 'processing', starting document processor`)

    await withTimeout(
      (async () => {
        const processed = await processDocument(
          docData.fileUrl,
          docData.filename,
          docData.mimeType,
          processingOptions.chunkSize || 512,
          processingOptions.chunkOverlap || 200,
          processingOptions.minCharactersPerChunk || 1
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

        // Generate embeddings in batches for large documents
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
            const batchEmbeddings = await generateEmbeddings(batch)
            embeddings.push(...batchEmbeddings)
          }
        }

        logger.info(`[${documentId}] Embeddings generated, fetching document tags`)

        const documentRecord = await db
          .select({
            tag1: document.tag1,
            tag2: document.tag2,
            tag3: document.tag3,
            tag4: document.tag4,
            tag5: document.tag5,
            tag6: document.tag6,
            tag7: document.tag7,
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
          // Copy tags from document
          tag1: documentTags.tag1,
          tag2: documentTags.tag2,
          tag3: documentTags.tag3,
          tag4: documentTags.tag4,
          tag5: documentTags.tag5,
          tag6: documentTags.tag6,
          tag7: documentTags.tag7,
          createdAt: now,
          updatedAt: now,
        }))

        await db.transaction(async (tx) => {
          // Insert embeddings in batches for large documents
          if (embeddingRecords.length > 0) {
            const batchSize = LARGE_DOC_CONFIG.MAX_CHUNKS_PER_BATCH
            const totalBatches = Math.ceil(embeddingRecords.length / batchSize)

            logger.info(
              `[${documentId}] Inserting ${embeddingRecords.length} embeddings in ${totalBatches} batches`
            )

            for (let i = 0; i < embeddingRecords.length; i += batchSize) {
              const batch = embeddingRecords.slice(i, i + batchSize)
              const batchNum = Math.floor(i / batchSize) + 1

              await tx.insert(embedding).values(batch)
              logger.info(
                `[${documentId}] Inserted batch ${batchNum}/${totalBatches} (${batch.length} records)`
              )
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
  return await db.transaction(async (tx) => {
    const now = new Date()
    const documentRecords = []
    const returnData: DocumentData[] = []

    for (const docData of documents) {
      const documentId = randomUUID()

      let processedTags: Record<string, string | null> = {
        tag1: null,
        tag2: null,
        tag3: null,
        tag4: null,
        tag5: null,
        tag6: null,
        tag7: null,
      }

      if (docData.documentTagsData) {
        try {
          const tagData = JSON.parse(docData.documentTagsData)
          if (Array.isArray(tagData)) {
            processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
          }
        } catch (error) {
          logger.warn(`[${requestId}] Failed to parse documentTagsData for bulk document:`, error)
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
        // Use processed tags if available, otherwise fall back to individual tag fields
        tag1: processedTags.tag1 || docData.tag1 || null,
        tag2: processedTags.tag2 || docData.tag2 || null,
        tag3: processedTags.tag3 || docData.tag3 || null,
        tag4: processedTags.tag4 || docData.tag4 || null,
        tag5: processedTags.tag5 || docData.tag5 || null,
        tag6: processedTags.tag6 || docData.tag6 || null,
        tag7: processedTags.tag7 || docData.tag7 || null,
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
    includeDisabled?: boolean
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
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}> {
  const {
    includeDisabled = false,
    search,
    limit = 50,
    offset = 0,
    sortBy = 'filename',
    sortOrder = 'asc',
  } = options

  // Build where conditions
  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    isNull(document.deletedAt),
  ]

  // Filter out disabled documents unless specifically requested
  if (!includeDisabled) {
    whereConditions.push(eq(document.enabled, true))
  }

  // Add search condition if provided
  if (search) {
    whereConditions.push(
      // Search in filename
      sql`LOWER(${document.filename}) LIKE LOWER(${`%${search}%`})`
    )
  }

  // Get total count for pagination
  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(document)
    .where(and(...whereConditions))

  const total = totalResult[0]?.count || 0
  const hasMore = offset + limit < total

  // Create dynamic order by clause
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
      default:
        return document.uploadedAt
    }
  }

  // Use stable secondary sort to prevent shifting when primary values are identical
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
      // Include tags in response
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
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
      tag1: doc.tag1,
      tag2: doc.tag2,
      tag3: doc.tag3,
      tag4: doc.tag4,
      tag5: doc.tag5,
      tag6: doc.tag6,
      tag7: doc.tag7,
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
  const documentId = randomUUID()
  const now = new Date()

  // Process structured tag data if provided
  let processedTags: Record<string, string | null> = {
    tag1: documentData.tag1 || null,
    tag2: documentData.tag2 || null,
    tag3: documentData.tag3 || null,
    tag4: documentData.tag4 || null,
    tag5: documentData.tag5 || null,
    tag6: documentData.tag6 || null,
    tag7: documentData.tag7 || null,
  }

  if (documentData.documentTagsData) {
    try {
      const tagData = JSON.parse(documentData.documentTagsData)
      if (Array.isArray(tagData)) {
        // Process structured tag data and create tag definitions
        processedTags = await processDocumentTags(knowledgeBaseId, tagData, requestId)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Failed to parse documentTagsData:`, error)
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

  // Verify all documents belong to this knowledge base
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
    // Handle bulk soft delete
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
    // Handle bulk enable/disable
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
 * Mark a document as failed due to timeout
 */
export async function markDocumentAsFailedTimeout(
  documentId: string,
  processingStartedAt: Date,
  requestId: string
): Promise<{ success: boolean; processingDuration: number }> {
  const now = new Date()
  const processingDuration = now.getTime() - processingStartedAt.getTime()
  const DEAD_PROCESS_THRESHOLD_MS = 150 * 1000

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
  // Clear existing embeddings and reset document state
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
    chunkSize: 512,
    minCharactersPerChunk: 24,
    recipe: 'default',
    lang: 'en',
    chunkOverlap: 100,
  }

  // Start processing in the background
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
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
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
  }> = {}
  const TAG_SLOTS = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const
  type TagSlot = (typeof TAG_SLOTS)[number]

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

  TAG_SLOTS.forEach((slot: TagSlot) => {
    const updateValue = (updateData as any)[slot]
    if (updateValue !== undefined) {
      ;(dbUpdateData as any)[slot] = updateValue
    }
  })

  await db.transaction(async (tx) => {
    await tx.update(document).set(dbUpdateData).where(eq(document.id, documentId))

    const hasTagUpdates = TAG_SLOTS.some((field) => (updateData as any)[field] !== undefined)

    if (hasTagUpdates) {
      const embeddingUpdateData: Record<string, string | null> = {}
      TAG_SLOTS.forEach((field) => {
        if ((updateData as any)[field] !== undefined) {
          embeddingUpdateData[field] = (updateData as any)[field] || null
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
