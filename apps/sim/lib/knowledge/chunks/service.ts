import { createHash, randomUUID } from 'crypto'
import { db } from '@sim/db'
import { document, embedding } from '@sim/db/schema'
import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { generateEmbeddings } from '@/lib/embeddings/utils'
import type {
  BatchOperationResult,
  ChunkData,
  ChunkFilters,
  ChunkQueryResult,
  CreateChunkData,
} from '@/lib/knowledge/chunks/types'
import { createLogger } from '@/lib/logs/console/logger'
import { estimateTokenCount } from '@/lib/tokenization/estimators'

const logger = createLogger('ChunksService')

/**
 * Query chunks for a document with filtering and pagination
 */
export async function queryChunks(
  documentId: string,
  filters: ChunkFilters,
  requestId: string
): Promise<ChunkQueryResult> {
  const { search, enabled = 'all', limit = 50, offset = 0 } = filters

  // Build query conditions
  const conditions = [eq(embedding.documentId, documentId)]

  // Add enabled filter
  if (enabled === 'true') {
    conditions.push(eq(embedding.enabled, true))
  } else if (enabled === 'false') {
    conditions.push(eq(embedding.enabled, false))
  }

  // Add search filter
  if (search) {
    conditions.push(ilike(embedding.content, `%${search}%`))
  }

  // Fetch chunks
  const chunks = await db
    .select({
      id: embedding.id,
      chunkIndex: embedding.chunkIndex,
      content: embedding.content,
      contentLength: embedding.contentLength,
      tokenCount: embedding.tokenCount,
      enabled: embedding.enabled,
      startOffset: embedding.startOffset,
      endOffset: embedding.endOffset,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      createdAt: embedding.createdAt,
      updatedAt: embedding.updatedAt,
    })
    .from(embedding)
    .where(and(...conditions))
    .orderBy(asc(embedding.chunkIndex))
    .limit(limit)
    .offset(offset)

  // Get total count for pagination
  const totalCount = await db
    .select({ count: sql`count(*)` })
    .from(embedding)
    .where(and(...conditions))

  logger.info(`[${requestId}] Retrieved ${chunks.length} chunks for document ${documentId}`)

  return {
    chunks: chunks as ChunkData[],
    pagination: {
      total: Number(totalCount[0]?.count || 0),
      limit,
      offset,
      hasMore: chunks.length === limit,
    },
  }
}

/**
 * Create a new chunk for a document
 */
export async function createChunk(
  knowledgeBaseId: string,
  documentId: string,
  docTags: Record<string, string | null>,
  chunkData: CreateChunkData,
  requestId: string
): Promise<ChunkData> {
  // Generate embedding for the content first (outside transaction for performance)
  logger.info(`[${requestId}] Generating embedding for manual chunk`)
  const embeddings = await generateEmbeddings([chunkData.content])

  // Calculate accurate token count
  const tokenCount = estimateTokenCount(chunkData.content, 'openai')

  const chunkId = randomUUID()
  const now = new Date()

  // Use transaction to atomically get next index and insert chunk
  const newChunk = await db.transaction(async (tx) => {
    // Get the next chunk index atomically within the transaction
    const lastChunk = await tx
      .select({ chunkIndex: embedding.chunkIndex })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
      .orderBy(sql`${embedding.chunkIndex} DESC`)
      .limit(1)

    const nextChunkIndex = lastChunk.length > 0 ? lastChunk[0].chunkIndex + 1 : 0

    const chunkDBData = {
      id: chunkId,
      knowledgeBaseId,
      documentId,
      chunkIndex: nextChunkIndex,
      chunkHash: createHash('sha256').update(chunkData.content).digest('hex'),
      content: chunkData.content,
      contentLength: chunkData.content.length,
      tokenCount: tokenCount.count,
      embedding: embeddings[0],
      embeddingModel: 'text-embedding-3-small',
      startOffset: 0, // Manual chunks don't have document offsets
      endOffset: chunkData.content.length,
      // Inherit tags from parent document
      tag1: docTags.tag1,
      tag2: docTags.tag2,
      tag3: docTags.tag3,
      tag4: docTags.tag4,
      tag5: docTags.tag5,
      tag6: docTags.tag6,
      tag7: docTags.tag7,
      enabled: chunkData.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }

    await tx.insert(embedding).values(chunkDBData)

    // Update document statistics
    await tx
      .update(document)
      .set({
        chunkCount: sql`${document.chunkCount} + 1`,
        tokenCount: sql`${document.tokenCount} + ${tokenCount.count}`,
        characterCount: sql`${document.characterCount} + ${chunkData.content.length}`,
      })
      .where(eq(document.id, documentId))

    return {
      id: chunkId,
      chunkIndex: nextChunkIndex,
      content: chunkData.content,
      contentLength: chunkData.content.length,
      tokenCount: tokenCount.count,
      enabled: chunkData.enabled ?? true,
      startOffset: 0,
      endOffset: chunkData.content.length,
      tag1: docTags.tag1,
      tag2: docTags.tag2,
      tag3: docTags.tag3,
      tag4: docTags.tag4,
      tag5: docTags.tag5,
      tag6: docTags.tag6,
      tag7: docTags.tag7,
      createdAt: now,
      updatedAt: now,
    } as ChunkData
  })

  logger.info(`[${requestId}] Created chunk ${chunkId} in document ${documentId}`)

  return newChunk
}

/**
 * Perform batch operations on chunks
 */
export async function batchChunkOperation(
  documentId: string,
  operation: 'enable' | 'disable' | 'delete',
  chunkIds: string[],
  requestId: string
): Promise<BatchOperationResult> {
  logger.info(
    `[${requestId}] Starting batch ${operation} operation on ${chunkIds.length} chunks for document ${documentId}`
  )

  const errors: string[] = []
  let successCount = 0

  if (operation === 'delete') {
    // Handle batch delete with transaction for consistency
    await db.transaction(async (tx) => {
      // Get chunks to delete for statistics update
      const chunksToDelete = await tx
        .select({
          id: embedding.id,
          tokenCount: embedding.tokenCount,
          contentLength: embedding.contentLength,
        })
        .from(embedding)
        .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

      if (chunksToDelete.length === 0) {
        errors.push('No matching chunks found to delete')
        return
      }

      const totalTokensToRemove = chunksToDelete.reduce((sum, chunk) => sum + chunk.tokenCount, 0)
      const totalCharsToRemove = chunksToDelete.reduce((sum, chunk) => sum + chunk.contentLength, 0)

      // Delete chunks
      const deleteResult = await tx
        .delete(embedding)
        .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

      // Update document statistics
      await tx
        .update(document)
        .set({
          chunkCount: sql`${document.chunkCount} - ${chunksToDelete.length}`,
          tokenCount: sql`${document.tokenCount} - ${totalTokensToRemove}`,
          characterCount: sql`${document.characterCount} - ${totalCharsToRemove}`,
        })
        .where(eq(document.id, documentId))

      successCount = chunksToDelete.length
    })
  } else {
    // Handle enable/disable operations
    const enabled = operation === 'enable'

    await db
      .update(embedding)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

    // For enable/disable, we assume all chunks were processed successfully
    successCount = chunkIds.length
  }

  logger.info(
    `[${requestId}] Batch ${operation} completed: ${successCount} chunks processed, ${errors.length} errors`
  )

  return {
    success: errors.length === 0,
    processed: successCount,
    errors,
  }
}

/**
 * Update a single chunk
 */
export async function updateChunk(
  chunkId: string,
  updateData: {
    content?: string
    enabled?: boolean
  },
  requestId: string
): Promise<ChunkData> {
  const dbUpdateData: {
    updatedAt: Date
    content?: string
    contentLength?: number
    tokenCount?: number
    chunkHash?: string
    embedding?: number[]
    enabled?: boolean
  } = {
    updatedAt: new Date(),
  }

  // Use transaction if content is being updated to ensure consistent document statistics
  if (updateData.content !== undefined && typeof updateData.content === 'string') {
    return await db.transaction(async (tx) => {
      // Get current chunk data for character count calculation and content comparison
      const currentChunk = await tx
        .select({
          documentId: embedding.documentId,
          content: embedding.content,
          contentLength: embedding.contentLength,
          tokenCount: embedding.tokenCount,
        })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      if (currentChunk.length === 0) {
        throw new Error(`Chunk ${chunkId} not found`)
      }

      const oldContentLength = currentChunk[0].contentLength
      const oldTokenCount = currentChunk[0].tokenCount
      const content = updateData.content! // We know it's defined from the if check above
      const newContentLength = content.length

      // Only regenerate embedding if content actually changed
      if (content !== currentChunk[0].content) {
        logger.info(`[${requestId}] Content changed, regenerating embedding for chunk ${chunkId}`)

        // Generate new embedding for the updated content
        const embeddings = await generateEmbeddings([content])

        // Calculate accurate token count
        const tokenCount = estimateTokenCount(content, 'openai')

        dbUpdateData.content = content
        dbUpdateData.contentLength = newContentLength
        dbUpdateData.tokenCount = tokenCount.count
        dbUpdateData.chunkHash = createHash('sha256').update(content).digest('hex')
        // Add the embedding field to the update data
        dbUpdateData.embedding = embeddings[0]
      } else {
        // Content hasn't changed, just update other fields if needed
        dbUpdateData.content = content
        dbUpdateData.contentLength = newContentLength
        dbUpdateData.tokenCount = oldTokenCount // Keep the same token count if content is identical
        dbUpdateData.chunkHash = createHash('sha256').update(content).digest('hex')
      }

      if (updateData.enabled !== undefined) {
        dbUpdateData.enabled = updateData.enabled
      }

      // Update the chunk
      await tx.update(embedding).set(dbUpdateData).where(eq(embedding.id, chunkId))

      // Update document statistics for the character and token count changes
      const charDiff = newContentLength - oldContentLength
      const tokenDiff = dbUpdateData.tokenCount! - oldTokenCount

      await tx
        .update(document)
        .set({
          characterCount: sql`${document.characterCount} + ${charDiff}`,
          tokenCount: sql`${document.tokenCount} + ${tokenDiff}`,
        })
        .where(eq(document.id, currentChunk[0].documentId))

      // Fetch and return the updated chunk
      const updatedChunk = await tx
        .select({
          id: embedding.id,
          chunkIndex: embedding.chunkIndex,
          content: embedding.content,
          contentLength: embedding.contentLength,
          tokenCount: embedding.tokenCount,
          enabled: embedding.enabled,
          startOffset: embedding.startOffset,
          endOffset: embedding.endOffset,
          tag1: embedding.tag1,
          tag2: embedding.tag2,
          tag3: embedding.tag3,
          tag4: embedding.tag4,
          tag5: embedding.tag5,
          tag6: embedding.tag6,
          tag7: embedding.tag7,
          createdAt: embedding.createdAt,
          updatedAt: embedding.updatedAt,
        })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      logger.info(
        `[${requestId}] Updated chunk: ${chunkId}${updateData.content !== currentChunk[0].content ? ' (regenerated embedding)' : ''}`
      )

      return updatedChunk[0] as ChunkData
    })
  }

  // If only enabled status is being updated, no need for transaction
  if (updateData.enabled !== undefined) {
    dbUpdateData.enabled = updateData.enabled
  }

  await db.update(embedding).set(dbUpdateData).where(eq(embedding.id, chunkId))

  // Fetch the updated chunk
  const updatedChunk = await db
    .select({
      id: embedding.id,
      chunkIndex: embedding.chunkIndex,
      content: embedding.content,
      contentLength: embedding.contentLength,
      tokenCount: embedding.tokenCount,
      enabled: embedding.enabled,
      startOffset: embedding.startOffset,
      endOffset: embedding.endOffset,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      createdAt: embedding.createdAt,
      updatedAt: embedding.updatedAt,
    })
    .from(embedding)
    .where(eq(embedding.id, chunkId))
    .limit(1)

  if (updatedChunk.length === 0) {
    throw new Error(`Chunk ${chunkId} not found`)
  }

  logger.info(`[${requestId}] Updated chunk: ${chunkId}`)

  return updatedChunk[0] as ChunkData
}

/**
 * Delete a single chunk with document statistics updates
 */
export async function deleteChunk(
  chunkId: string,
  documentId: string,
  requestId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // Get chunk data before deletion for statistics update
    const chunkToDelete = await tx
      .select({
        tokenCount: embedding.tokenCount,
        contentLength: embedding.contentLength,
      })
      .from(embedding)
      .where(eq(embedding.id, chunkId))
      .limit(1)

    if (chunkToDelete.length === 0) {
      throw new Error('Chunk not found')
    }

    const chunk = chunkToDelete[0]

    // Delete the chunk
    await tx.delete(embedding).where(eq(embedding.id, chunkId))

    // Update document statistics
    await tx
      .update(document)
      .set({
        chunkCount: sql`${document.chunkCount} - 1`,
        tokenCount: sql`${document.tokenCount} - ${chunk.tokenCount}`,
        characterCount: sql`${document.characterCount} - ${chunk.contentLength}`,
      })
      .where(eq(document.id, documentId))
  })

  logger.info(`[${requestId}] Deleted chunk: ${chunkId}`)
}
