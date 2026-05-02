import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  knowledgeConnector,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { tasks } from '@trigger.dev/sdk'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isTriggerDevEnabled } from '@/lib/core/config/feature-flags'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { getEmbeddingModelInfo } from '@/lib/knowledge/embedding-models'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import {
  buildUndefinedTagsError,
  parseBooleanValue,
  parseDateValue,
  parseNumberValue,
  validateTagValue,
} from '@/lib/knowledge/tags/utils'
import type { ProcessedDocumentTags } from '@/lib/knowledge/types'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import type { DocumentProcessingPayload } from '@/background/knowledge-processing'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('DocumentService')

const TIMEOUTS = {
  OVERALL_PROCESSING: (env.KB_CONFIG_MAX_DURATION || 600) * 1000,
} as const

const LARGE_DOC_CONFIG = {
  MAX_CHUNKS_PER_BATCH: 500,
  MAX_EMBEDDING_BATCH: env.KB_CONFIG_BATCH_SIZE || 2000,
  MAX_FILE_SIZE: 100 * 1024 * 1024,
  MAX_CHUNKS_PER_DOCUMENT: 100000,
}

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

export function getProcessingConfig() {
  return PROCESSING_CONFIG
}

export interface DocumentData {
  documentId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
}

export interface ProcessingOptions {
  recipe?: string
  lang?: string
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

export async function dispatchDocumentProcessingJob(payload: DocumentJobData): Promise<void> {
  if (isTriggerAvailable()) {
    await tasks.trigger('knowledge-process-document', payload, {
      tags: [`knowledgeBaseId:${payload.knowledgeBaseId}`, `documentId:${payload.documentId}`],
    })
    return
  }

  await processDocumentAsync(
    payload.knowledgeBaseId,
    payload.documentId,
    payload.docData,
    payload.processingOptions
  )
}

export interface DocumentTagData {
  tagName: string
  fieldType: string
  value: string
}

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

export async function processDocumentsWithQueue(
  createdDocuments: DocumentData[],
  knowledgeBaseId: string,
  processingOptions: ProcessingOptions,
  requestId: string
): Promise<void> {
  const jobPayloads = createdDocuments.map<DocumentJobData>((doc) => ({
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

  logger.info(
    `[${requestId}] Dispatching background processing for ${jobPayloads.length} documents`,
    {
      backend: isTriggerAvailable() ? 'trigger-dev' : 'direct',
    }
  )

  const results = await Promise.allSettled(
    jobPayloads.map((payload) => dispatchDocumentProcessingJob(payload))
  )

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    logger.error(`[${requestId}] ${failures.length}/${results.length} document dispatches failed`, {
      errors: failures.map((f) =>
        f.reason instanceof Error ? f.reason.message : String(f.reason)
      ),
    })
  }

  logger.info(
    `[${requestId}] Document dispatch complete: ${results.length - failures.length}/${results.length} succeeded`
  )

  if (failures.length === results.length) {
    throw new Error(`All ${failures.length} document processing dispatches failed`)
  }

  return
}

export async function processDocumentAsync(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  processingOptions: ProcessingOptions = {}
): Promise<void> {
  const startTime = Date.now()
  try {
    logger.info(`[${documentId}] Starting document processing: ${docData.filename}`)

    const kb = await db
      .select({
        userId: knowledgeBase.userId,
        workspaceId: knowledgeBase.workspaceId,
        chunkingConfig: knowledgeBase.chunkingConfig,
        embeddingModel: knowledgeBase.embeddingModel,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (kb.length === 0) {
      logger.warn(
        `[${documentId}] Skipping document processing: knowledge base ${knowledgeBaseId} is deleted`
      )
      await db
        .update(document)
        .set({
          processingStatus: 'failed',
          processingError: 'Knowledge base deleted',
          processingCompletedAt: new Date(),
        })
        .where(
          and(eq(document.id, documentId), isNull(document.archivedAt), isNull(document.deletedAt))
        )
      return
    }

    await db
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt: new Date(),
        processingCompletedAt: null,
        processingError: null,
      })
      .where(
        and(eq(document.id, documentId), isNull(document.archivedAt), isNull(document.deletedAt))
      )

    logger.info(`[${documentId}] Status updated to 'processing', starting document processor`)

    const rawConfig = kb[0].chunkingConfig as {
      maxSize?: number
      minSize?: number
      overlap?: number
      strategy?: ChunkingStrategy
      strategyOptions?: StrategyOptions
    } | null
    const kbConfig = {
      maxSize: rawConfig?.maxSize ?? 1024,
      minSize: rawConfig?.minSize ?? 100,
      overlap: rawConfig?.overlap ?? 200,
    }

    const kbEmbeddingModel = kb[0].embeddingModel
    if (!kb[0].workspaceId) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is missing workspace billing context`)
    }
    const billingUserId = await getWorkspaceBilledAccountUserId(kb[0].workspaceId)
    if (!billingUserId) {
      throw new Error(`Workspace ${kb[0].workspaceId} is missing billed account`)
    }
    let totalEmbeddingTokens = 0
    let embeddingIsBYOK = false
    let embeddingModelName = kbEmbeddingModel
    let embeddingPricingId = kbEmbeddingModel

    await withTimeout(
      (async () => {
        const processed = await processDocument(
          docData.fileUrl,
          docData.filename,
          docData.mimeType,
          kbConfig.maxSize,
          kbConfig.overlap,
          kbConfig.minSize,
          kb[0].userId,
          kb[0].workspaceId,
          rawConfig?.strategy,
          rawConfig?.strategyOptions
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
            const {
              embeddings: batchEmbeddings,
              totalTokens: batchTokens,
              isBYOK,
              modelName,
              pricingId,
            } = await generateEmbeddings(batch, kbEmbeddingModel, kb[0].workspaceId)
            for (const emb of batchEmbeddings) {
              embeddings.push(emb)
            }
            totalEmbeddingTokens += batchTokens
            if (i === 0) {
              embeddingIsBYOK = isBYOK
              embeddingModelName = modelName
              embeddingPricingId = pricingId
            }
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
            number1: document.number1,
            number2: document.number2,
            number3: document.number3,
            number4: document.number4,
            number5: document.number5,
            date1: document.date1,
            date2: document.date2,
            boolean1: document.boolean1,
            boolean2: document.boolean2,
            boolean3: document.boolean3,
          })
          .from(document)
          .where(
            and(
              eq(document.id, documentId),
              isNull(document.archivedAt),
              isNull(document.deletedAt)
            )
          )
          .limit(1)

        const documentTags = documentRecord[0] || {}

        logger.info(`[${documentId}] Creating embedding records with tags`)

        const tokenizerProvider = getEmbeddingModelInfo(kbEmbeddingModel).tokenizerProvider

        const embeddingRecords = processed.chunks.map((chunk, chunkIndex) => ({
          id: generateId(),
          knowledgeBaseId,
          documentId,
          chunkIndex,
          chunkHash: sha256Hex(chunk.text),
          content: chunk.text,
          contentLength: chunk.text.length,
          tokenCount: estimateTokenCount(chunk.text, tokenizerProvider).count,
          embedding: embeddings[chunkIndex] || null,
          embeddingModel: kbEmbeddingModel,
          startOffset: chunk.metadata.startIndex,
          endOffset: chunk.metadata.endIndex,
          tag1: documentTags.tag1,
          tag2: documentTags.tag2,
          tag3: documentTags.tag3,
          tag4: documentTags.tag4,
          tag5: documentTags.tag5,
          tag6: documentTags.tag6,
          tag7: documentTags.tag7,
          number1: documentTags.number1,
          number2: documentTags.number2,
          number3: documentTags.number3,
          number4: documentTags.number4,
          number5: documentTags.number5,
          date1: documentTags.date1,
          date2: documentTags.date2,
          boolean1: documentTags.boolean1,
          boolean2: documentTags.boolean2,
          boolean3: documentTags.boolean3,
          createdAt: now,
          updatedAt: now,
        }))

        await db.transaction(async (tx) => {
          const activeDocument = await tx
            .select({ id: document.id })
            .from(document)
            .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
            .where(
              and(
                eq(document.id, documentId),
                isNull(document.archivedAt),
                isNull(document.deletedAt),
                isNull(knowledgeBase.deletedAt)
              )
            )
            .limit(1)

          if (activeDocument.length === 0) {
            return
          }

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

    if (!embeddingIsBYOK && totalEmbeddingTokens > 0 && billingUserId) {
      try {
        const costMultiplier = getCostMultiplier()
        const { total: cost } = calculateCost(
          embeddingPricingId,
          totalEmbeddingTokens,
          0,
          false,
          costMultiplier
        )
        if (cost > 0) {
          await recordUsage({
            userId: billingUserId,
            workspaceId: kb[0].workspaceId ?? undefined,
            entries: [
              {
                category: 'model',
                source: 'knowledge-base',
                description: embeddingModelName,
                cost,
                metadata: { inputTokens: totalEmbeddingTokens, outputTokens: 0 },
              },
            ],
            additionalStats: {
              totalTokensUsed: sql`total_tokens_used + ${totalEmbeddingTokens}`,
            },
          })
          await checkAndBillOverageThreshold(billingUserId)
        } else {
          logger.warn(
            `[${documentId}] Embedding model "${embeddingModelName}" has no pricing entry — billing skipped`,
            { totalEmbeddingTokens, embeddingModelName }
          )
        }
      } catch (billingError) {
        logger.error(`[${documentId}] Failed to record embedding usage`, { error: billingError })
      }
    }
  } catch (error) {
    const processingTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${documentId}] Failed to process document after ${processingTime}ms:`, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      filename: docData.filename,
      fileUrl: docData.fileUrl,
      mimeType: docData.mimeType,
    })

    await db
      .update(document)
      .set({
        processingStatus: 'failed',
        processingError: errorMessage,
        processingCompletedAt: new Date(),
      })
      .where(eq(document.id, documentId))

    throw error
  }
}

export function isTriggerAvailable(): boolean {
  return Boolean(env.TRIGGER_SECRET_KEY) && isTriggerDevEnabled
}

export async function processDocumentsWithTrigger(
  documents: DocumentProcessingPayload[],
  requestId: string
): Promise<{ success: boolean; message: string; batchIds?: string[] }> {
  if (!isTriggerAvailable()) {
    throw new Error('Trigger.dev is not configured - TRIGGER_SECRET_KEY missing')
  }

  try {
    logger.info(`[${requestId}] Triggering background processing for ${documents.length} documents`)

    const MAX_BATCH_SIZE = 1000
    const batchIds: string[] = []

    for (let i = 0; i < documents.length; i += MAX_BATCH_SIZE) {
      const chunk = documents.slice(i, i + MAX_BATCH_SIZE)
      const batchResult = await tasks.batchTrigger(
        'knowledge-process-document',
        chunk.map((doc) => ({
          payload: doc,
          options: {
            idempotencyKey: `doc-process-${doc.documentId}-${requestId}`,
            tags: [`knowledgeBaseId:${doc.knowledgeBaseId}`, `documentId:${doc.documentId}`],
          },
        }))
      )
      batchIds.push(batchResult.batchId)
    }

    logger.info(
      `[${requestId}] Triggered ${documents.length} document processing jobs in ${batchIds.length} batch(es)`
    )

    return {
      success: true,
      message: `${documents.length} document processing jobs triggered`,
      batchIds,
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to trigger document processing jobs:`, error)

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to trigger background jobs',
    }
  }
}

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
    await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

    const kb = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (kb.length === 0) {
      throw new Error('Knowledge base not found')
    }

    const now = new Date()
    const documentRecords = []
    const returnData: DocumentData[] = []

    for (const docData of documents) {
      const documentId = generateId()

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
        tag1: processedTags.tag1 ?? docData.tag1 ?? null,
        tag2: processedTags.tag2 ?? docData.tag2 ?? null,
        tag3: processedTags.tag3 ?? docData.tag3 ?? null,
        tag4: processedTags.tag4 ?? docData.tag4 ?? null,
        tag5: processedTags.tag5 ?? docData.tag5 ?? null,
        tag6: processedTags.tag6 ?? docData.tag6 ?? null,
        tag7: processedTags.tag7 ?? docData.tag7 ?? null,
        number1: processedTags.number1 ?? null,
        number2: processedTags.number2 ?? null,
        number3: processedTags.number3 ?? null,
        number4: processedTags.number4 ?? null,
        number5: processedTags.number5 ?? null,
        date1: processedTags.date1 ?? null,
        date2: processedTags.date2 ?? null,
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

export interface TagFilterCondition {
  tagSlot: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
  operator: string
  value: unknown
  valueTo?: unknown
}

const ALLOWED_TAG_SLOTS = new Set([
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
])

function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function buildTagFilterCondition(filter: TagFilterCondition): SQL | undefined {
  if (!ALLOWED_TAG_SLOTS.has(filter.tagSlot)) return undefined

  const col = document[filter.tagSlot as keyof typeof document]

  if (filter.fieldType === 'text') {
    const v = String(filter.value ?? '')
    switch (filter.operator) {
      case 'eq':
        return eq(col as typeof document.tag1, v)
      case 'neq':
        return ne(col as typeof document.tag1, v)
      case 'contains': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`
      }
      case 'not_contains': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) NOT LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`
      }
      case 'starts_with': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) LIKE LOWER(${`${escaped}%`}) ESCAPE '\\'`
      }
      case 'ends_with': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) LIKE LOWER(${`%${escaped}`}) ESCAPE '\\'`
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'number') {
    const num = Number(filter.value)
    if (Number.isNaN(num)) return undefined
    switch (filter.operator) {
      case 'eq':
        return eq(col as typeof document.number1, num)
      case 'neq':
        return ne(col as typeof document.number1, num)
      case 'gt':
        return gt(col as typeof document.number1, num)
      case 'gte':
        return gte(col as typeof document.number1, num)
      case 'lt':
        return lt(col as typeof document.number1, num)
      case 'lte':
        return lte(col as typeof document.number1, num)
      case 'between': {
        const numTo = Number(filter.valueTo)
        if (Number.isNaN(numTo)) return undefined
        return and(
          gte(col as typeof document.number1, num),
          lte(col as typeof document.number1, numTo)
        )
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'date') {
    const v = String(filter.value ?? '')
    switch (filter.operator) {
      case 'eq':
        return eq(col as typeof document.date1, new Date(v))
      case 'neq':
        return ne(col as typeof document.date1, new Date(v))
      case 'gt':
        return gt(col as typeof document.date1, new Date(v))
      case 'gte':
        return gte(col as typeof document.date1, new Date(v))
      case 'lt':
        return lt(col as typeof document.date1, new Date(v))
      case 'lte':
        return lte(col as typeof document.date1, new Date(v))
      case 'between': {
        if (!filter.valueTo) return undefined
        const valueTo = String(filter.valueTo)
        return and(
          gte(col as typeof document.date1, new Date(v)),
          lte(col as typeof document.date1, new Date(valueTo))
        )
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'boolean') {
    const boolVal =
      typeof filter.value === 'boolean' ? filter.value : parseBooleanValue(String(filter.value))
    if (boolVal === null) return undefined
    switch (filter.operator) {
      case 'eq':
        return eq(col as typeof document.boolean1, boolVal)
      case 'neq':
        return ne(col as typeof document.boolean1, boolVal)
      default:
        return undefined
    }
  }

  return undefined
}

export async function getDocuments(
  knowledgeBaseId: string,
  options: {
    enabledFilter?: 'all' | 'enabled' | 'disabled'
    search?: string
    limit?: number
    offset?: number
    sortBy?: DocumentSortField
    sortOrder?: SortOrder
    tagFilters?: TagFilterCondition[]
  },
  requestId: string
): Promise<{
  documents: Array<{
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
    connectorId: string | null
    connectorType: string | null
    sourceUrl: string | null
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
    tagFilters,
  } = options

  const whereConditions: (SQL | undefined)[] = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
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

  if (tagFilters && tagFilters.length > 0) {
    for (const filter of tagFilters) {
      const condition = buildTagFilterCondition(filter)
      if (condition) {
        whereConditions.push(condition)
      }
    }
  }

  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(document)
    .where(and(...whereConditions))

  const total = Number(totalResult[0]?.count ?? 0)
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
      knowledgeBaseId: document.knowledgeBaseId,
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
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
      number1: document.number1,
      number2: document.number2,
      number3: document.number3,
      number4: document.number4,
      number5: document.number5,
      date1: document.date1,
      date2: document.date2,
      boolean1: document.boolean1,
      boolean2: document.boolean2,
      boolean3: document.boolean3,
      connectorId: document.connectorId,
      connectorType: knowledgeConnector.connectorType,
      sourceUrl: document.sourceUrl,
    })
    .from(document)
    .leftJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
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
      connectorId: doc.connectorId,
      connectorType: doc.connectorType ?? null,
      sourceUrl: doc.sourceUrl,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore,
    },
  }
}

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
  const documentId = generateId()
  const now = new Date()

  let processedTags: ProcessedDocumentTags = {
    tag1: documentData.tag1 ?? null,
    tag2: documentData.tag2 ?? null,
    tag3: documentData.tag3 ?? null,
    tag4: documentData.tag4 ?? null,
    tag5: documentData.tag5 ?? null,
    tag6: documentData.tag6 ?? null,
    tag7: documentData.tag7 ?? null,
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

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

    const kb = await tx
      .select({ id: knowledgeBase.id })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (kb.length === 0) {
      throw new Error('Knowledge base not found')
    }

    await tx.insert(document).values(newDocument)

    await tx
      .update(knowledgeBase)
      .set({ updatedAt: now })
      .where(eq(knowledgeBase.id, knowledgeBaseId))
  })
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
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
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
    const deletedIds = documentsToUpdate.map((doc) => doc.id)
    const deletedCount = await deleteDocumentsByLifecyclePolicy(deletedIds, requestId)
    updateResult = deletedIds.slice(0, deletedCount).map((id) => ({ id }))
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
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
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
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
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
    const matchingDocs = await db
      .select({ id: document.id })
      .from(document)
      .where(and(...whereConditions))

    const deletedIds = matchingDocs.map((doc) => doc.id)
    const deletedCount = await deleteDocumentsByLifecyclePolicy(deletedIds, requestId)
    updateResult = deletedIds.slice(0, deletedCount).map((id) => ({ id }))
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
      processingError: 'Processing timed out. Please retry or re-sync the connector.',
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

  await processDocumentsWithQueue(
    [
      {
        documentId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
      },
    ],
    knowledgeBaseId,
    {},
    requestId
  )

  logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

  return {
    success: true,
    status: 'pending',
    message: 'Document retry processing started',
  }
}

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
    number1?: string
    number2?: string
    number3?: string
    number4?: string
    number5?: string
    date1?: string
    date2?: string
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

    if (slot.startsWith('number')) {
      return parseNumberValue(value)
    }

    if (slot.startsWith('date')) {
      return parseDateValue(value)
    }

    if (slot.startsWith('boolean')) {
      return parseBooleanValue(value) ?? false
    }

    return value || null
  }

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

function getKnowledgeBaseStorageKey(fileUrl: string | null): string | null {
  if (!fileUrl) {
    return null
  }

  try {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const storageKey = extractStorageKey(urlPath)
    return storageKey !== urlPath ? storageKey : null
  } catch {
    return null
  }
}

export async function deleteDocumentStorageFiles(
  documentsToDelete: Array<{ id: string; fileUrl: string | null }>,
  requestId: string
): Promise<void> {
  await Promise.allSettled(
    documentsToDelete.map(async (doc) => {
      const storageKey = getKnowledgeBaseStorageKey(doc.fileUrl)
      if (!storageKey) {
        return
      }

      try {
        await deleteFile({ key: storageKey, context: 'knowledge-base' })
      } catch (error) {
        logger.warn(`[${requestId}] Failed to delete document storage file`, {
          documentId: doc.id,
          error: toError(error).message,
        })
      }
    })
  )
}

async function excludeConnectorDocuments(
  documentIds: string[],
  requestId: string
): Promise<number> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) {
    return 0
  }

  const updated = await db
    .update(document)
    .set({
      userExcluded: true,
      enabled: false,
    })
    .where(and(inArray(document.id, ids), isNotNull(document.connectorId)))
    .returning({ id: document.id })

  if (updated.length > 0) {
    logger.info(`[${requestId}] Excluded ${updated.length} connector-backed document(s)`, {
      documentIds: updated.map((doc) => doc.id),
    })
  }

  return updated.length
}

export async function deleteDocumentsByLifecyclePolicy(
  documentIds: string[],
  requestId: string
): Promise<number> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) {
    return 0
  }

  const docs = await db
    .select({
      id: document.id,
      connectorId: document.connectorId,
    })
    .from(document)
    .where(inArray(document.id, ids))

  const connectorBackedIds = docs.filter((doc) => doc.connectorId !== null).map((doc) => doc.id)
  const hardDeleteIds = docs.filter((doc) => doc.connectorId === null).map((doc) => doc.id)

  const [excludedCount, hardDeletedCount] = await Promise.all([
    excludeConnectorDocuments(connectorBackedIds, requestId),
    hardDeleteDocuments(hardDeleteIds, requestId),
  ])

  return excludedCount + hardDeletedCount
}

export async function hardDeleteDocuments(
  documentIds: string[],
  requestId: string
): Promise<number> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) {
    return 0
  }

  const documentsToDelete = await db
    .select({
      id: document.id,
      fileUrl: document.fileUrl,
    })
    .from(document)
    .where(inArray(document.id, ids))

  if (documentsToDelete.length === 0) {
    return 0
  }

  const existingIds = documentsToDelete.map((doc) => doc.id)

  await db.transaction(async (tx) => {
    await tx.delete(embedding).where(inArray(embedding.documentId, existingIds))
    await tx.delete(document).where(inArray(document.id, existingIds))
  })

  await deleteDocumentStorageFiles(documentsToDelete, requestId)

  logger.info(`[${requestId}] Hard deleted ${existingIds.length} documents`, {
    documentIds: existingIds,
  })

  return existingIds.length
}

export async function deleteDocument(
  documentId: string,
  requestId: string
): Promise<{ success: boolean; message: string }> {
  await deleteDocumentsByLifecyclePolicy([documentId], requestId)

  return {
    success: true,
    message: 'Document deleted successfully',
  }
}
