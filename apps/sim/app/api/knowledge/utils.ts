import crypto from 'crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { processDocument } from '@/lib/documents/document-processor'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding, knowledgeBase } from '@/db/schema'

const logger = createLogger('KnowledgeUtils')

class APIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

export interface KnowledgeBaseData {
  id: string
  userId: string
  workspaceId?: string | null
  name: string
  description?: string | null
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: unknown
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  fileHash?: string | null
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: string
  processingStartedAt?: Date | null
  processingCompletedAt?: Date | null
  processingError?: string | null
  enabled: boolean
  deletedAt?: Date | null
  uploadedAt: Date
}

export interface EmbeddingData {
  id: string
  knowledgeBaseId: string
  documentId: string
  chunkIndex: number
  chunkHash: string
  content: string
  contentLength: number
  tokenCount: number
  embedding?: number[] | null
  embeddingModel: string
  startOffset: number
  endOffset: number
  overlapTokens: number
  metadata: unknown
  searchRank?: string | null
  accessCount: number
  lastAccessedAt?: Date | null
  qualityScore?: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

export interface KnowledgeBaseAccessResult {
  hasAccess: true
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId'>
}

export interface KnowledgeBaseAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type KnowledgeBaseAccessCheck = KnowledgeBaseAccessResult | KnowledgeBaseAccessDenied

export interface DocumentAccessResult {
  hasAccess: true
  document: DocumentData
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId'>
}

export interface DocumentAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type DocumentAccessCheck = DocumentAccessResult | DocumentAccessDenied

export interface ChunkAccessResult {
  hasAccess: true
  chunk: EmbeddingData
  document: DocumentData
  knowledgeBase: Pick<KnowledgeBaseData, 'id' | 'userId'>
}

export interface ChunkAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type ChunkAccessCheck = ChunkAccessResult | ChunkAccessDenied

/**
 * Check if a user has access to a knowledge base
 */
export async function checkKnowledgeBaseAccess(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return { hasAccess: false, notFound: true }
  }

  const kbData = kb[0]

  if (kbData.userId === userId) {
    return { hasAccess: true, knowledgeBase: kbData }
  }

  return { hasAccess: false }
}

/**
 * Check if a user has access to a document within a knowledge base
 */
export async function checkDocumentAccess(
  knowledgeBaseId: string,
  documentId: string,
  userId: string
): Promise<DocumentAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return {
      hasAccess: false,
      notFound: true,
      reason: 'Knowledge base not found',
    }
  }

  const kbData = kb[0]

  if (kbData.userId !== userId) {
    return { hasAccess: false, reason: 'Unauthorized knowledge base access' }
  }

  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  return {
    hasAccess: true,
    document: doc[0] as DocumentData,
    knowledgeBase: kbData,
  }
}

/**
 * Check if a user has access to a chunk within a document and knowledge base
 */
export async function checkChunkAccess(
  knowledgeBaseId: string,
  documentId: string,
  chunkId: string,
  userId: string
): Promise<ChunkAccessCheck> {
  const kb = await db
    .select({
      id: knowledgeBase.id,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kb.length === 0) {
    return {
      hasAccess: false,
      notFound: true,
      reason: 'Knowledge base not found',
    }
  }

  const kbData = kb[0]

  if (kbData.userId !== userId) {
    return { hasAccess: false, reason: 'Unauthorized knowledge base access' }
  }

  const doc = await db
    .select()
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)

  if (doc.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Document not found' }
  }

  const docData = doc[0] as DocumentData

  // Check if document processing is completed
  if (docData.processingStatus !== 'completed') {
    return {
      hasAccess: false,
      reason: `Document is not ready for access (status: ${docData.processingStatus})`,
    }
  }

  const chunk = await db
    .select()
    .from(embedding)
    .where(and(eq(embedding.id, chunkId), eq(embedding.documentId, documentId)))
    .limit(1)

  if (chunk.length === 0) {
    return { hasAccess: false, notFound: true, reason: 'Chunk not found' }
  }

  return {
    hasAccess: true,
    chunk: chunk[0] as EmbeddingData,
    document: docData,
    knowledgeBase: kbData,
  }
}

/**
 * Generate embeddings using OpenAI API with retry logic for rate limiting
 */
export async function generateEmbeddings(
  texts: string[],
  embeddingModel = 'text-embedding-3-small'
): Promise<number[][]> {
  const openaiApiKey = env.OPENAI_API_KEY
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  try {
    const batchSize = 100
    const allEmbeddings: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      logger.info(
        `Generating embeddings for batch ${Math.floor(i / batchSize) + 1} (${batch.length} texts)`
      )

      const batchEmbeddings = await retryWithExponentialBackoff(
        async () => {
          const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              input: batch,
              model: embeddingModel,
              encoding_format: 'float',
            }),
          })

          if (!response.ok) {
            const errorText = await response.text()
            const error = new APIError(
              `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`,
              response.status
            )
            throw error
          }

          const data: OpenAIEmbeddingResponse = await response.json()
          return data.data.map((item) => item.embedding)
        },
        {
          maxRetries: 5,
          initialDelayMs: 1000,
          maxDelayMs: 60000, // Max 1 minute delay for embeddings
          backoffMultiplier: 2,
        }
      )

      allEmbeddings.push(...batchEmbeddings)
    }

    return allEmbeddings
  } catch (error) {
    logger.error('Failed to generate embeddings:', error)
    throw error
  }
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
    fileHash?: string | null
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

    // Set status to processing
    await db
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt: new Date(),
        processingError: null, // Clear any previous error
      })
      .where(eq(document.id, documentId))

    logger.info(`[${documentId}] Status updated to 'processing', starting document processor`)

    const processed = await processDocument(
      docData.fileUrl,
      docData.filename,
      docData.mimeType,
      processingOptions.chunkSize || 1000,
      processingOptions.chunkOverlap || 200
    )

    const now = new Date()

    logger.info(
      `[${documentId}] Document parsed successfully, generating embeddings for ${processed.chunks.length} chunks`
    )

    const chunkTexts = processed.chunks.map((chunk) => chunk.text)
    const embeddings = chunkTexts.length > 0 ? await generateEmbeddings(chunkTexts) : []

    logger.info(`[${documentId}] Embeddings generated, updating document record`)

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
      overlapTokens: 0,
      metadata: {},
      searchRank: '1.0',
      accessCount: 0,
      lastAccessedAt: null,
      qualityScore: null,
      createdAt: now,
      updatedAt: now,
    }))

    await db.transaction(async (tx) => {
      if (embeddingRecords.length > 0) {
        await tx.insert(embedding).values(embeddingRecords)
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

      await tx
        .update(knowledgeBase)
        .set({
          tokenCount: sql`${knowledgeBase.tokenCount} + ${processed.metadata.tokenCount}`,
          updatedAt: now,
        })
        .where(eq(knowledgeBase.id, knowledgeBaseId))
    })

    const processingTime = Date.now() - startTime
    logger.info(
      `[${documentId}] Successfully processed document with ${processed.metadata.chunkCount} chunks in ${processingTime}ms`
    )
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
