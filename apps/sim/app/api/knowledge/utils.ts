import { and, eq, isNull, sql } from 'drizzle-orm'
import { processDocuments } from '@/lib/documents/document-processor'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { document, embedding, knowledgeBase } from '@/db/schema'

const logger = createLogger('KnowledgeUtils')

// Type definitions for access checks
export interface KnowledgeBaseAccessResult {
  hasAccess: true
  knowledgeBase: any
}

export interface KnowledgeBaseAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason?: string
}

export type KnowledgeBaseAccessCheck = KnowledgeBaseAccessResult | KnowledgeBaseAccessDenied

export interface DocumentAccessResult {
  hasAccess: true
  document: any
  knowledgeBase: any
}

export interface DocumentAccessDenied {
  hasAccess: false
  notFound?: boolean
  reason: string
}

export type DocumentAccessCheck = DocumentAccessResult | DocumentAccessDenied

export interface ChunkAccessResult {
  hasAccess: true
  chunk: any
  document: any
  knowledgeBase: any
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
    return { hasAccess: false, notFound: true, reason: 'Knowledge base not found' }
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

  return { hasAccess: true, document: doc[0], knowledgeBase: kbData }
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
    return { hasAccess: false, notFound: true, reason: 'Knowledge base not found' }
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

  const docData = doc[0]

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

  return { hasAccess: true, chunk: chunk[0], document: docData, knowledgeBase: kbData }
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
            const error = new Error(
              `OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`
            )
            ;(error as any).status = response.status
            throw error
          }

          const data = await response.json()
          return data.data.map((item: any) => item.embedding)
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
  }
): Promise<void> {
  try {
    logger.info(`Processing document ${documentId}: ${docData.filename}`)

    await db
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt: new Date(),
      })
      .where(eq(document.id, documentId))

    const processedDocuments = await processDocuments(
      [
        {
          fileUrl: docData.fileUrl,
          filename: docData.filename,
          mimeType: docData.mimeType,
          fileSize: docData.fileSize,
        },
      ],
      {
        knowledgeBaseId,
        ...processingOptions,
      }
    )

    if (processedDocuments.length === 0) {
      throw new Error('No document was processed')
    }

    const processed = processedDocuments[0]
    const now = new Date()

    const chunkTexts = processed.chunks.map((chunk) => chunk.text)
    const embeddings = chunkTexts.length > 0 ? await generateEmbeddings(chunkTexts) : []

    await db
      .update(document)
      .set({
        chunkCount: processed.metadata.chunkCount,
        tokenCount: processed.metadata.tokenCount,
        characterCount: processed.metadata.characterCount,
        processingStatus: 'completed',
        processingCompletedAt: now,
      })
      .where(eq(document.id, documentId))

    const embeddingRecords = processed.chunks.map((chunk, chunkIndex) => ({
      id: crypto.randomUUID(),
      knowledgeBaseId,
      documentId,
      chunkIndex,
      chunkHash: crypto.randomUUID(),
      content: chunk.text,
      contentLength: chunk.text.length,
      tokenCount: Math.ceil(chunk.text.length / 4),
      embedding: embeddings[chunkIndex] || null,
      embeddingModel: 'text-embedding-3-small',
      startOffset: chunk.startIndex || 0,
      endOffset: chunk.endIndex || chunk.text.length,
      overlapTokens: 0,
      metadata: {},
      searchRank: '1.0',
      accessCount: 0,
      lastAccessedAt: null,
      qualityScore: null,
      createdAt: now,
      updatedAt: now,
    }))

    if (embeddingRecords.length > 0) {
      await db.insert(embedding).values(embeddingRecords)
    }

    await db
      .update(knowledgeBase)
      .set({
        tokenCount: sql`${knowledgeBase.tokenCount} + ${processed.metadata.tokenCount}`,
        updatedAt: now,
      })
      .where(eq(knowledgeBase.id, knowledgeBaseId))

    logger.info(
      `Successfully processed document ${documentId} with ${processed.metadata.chunkCount} chunks`
    )
  } catch (error) {
    logger.error(`Failed to process document ${documentId}:`, error)

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
