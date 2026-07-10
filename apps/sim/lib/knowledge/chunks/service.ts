import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import type {
  BatchOperationResult,
  ChunkData,
  ChunkFilters,
  ChunkQueryResult,
  CreateChunkData,
} from '@/lib/knowledge/chunks/types'
import { getEmbeddingModelInfo } from '@/lib/knowledge/embedding-models'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import { estimateTokenCount } from '@/lib/tokenization/estimators'

const logger = createLogger('ChunksService')

const KB_CHUNK_LOCK_TIMEOUT_MS = 5_000

/**
 * Query chunks for a document with filtering and pagination
 */
export async function queryChunks(
  documentId: string,
  filters: ChunkFilters,
  requestId: string
): Promise<ChunkQueryResult> {
  const {
    search,
    enabled = 'all',
    limit = 50,
    offset = 0,
    sortBy = 'chunkIndex',
    sortOrder = 'asc',
  } = filters

  const conditions = [eq(embedding.documentId, documentId)]

  if (enabled === 'true') {
    conditions.push(eq(embedding.enabled, true))
  } else if (enabled === 'false') {
    conditions.push(eq(embedding.enabled, false))
  }

  if (search) {
    conditions.push(ilike(embedding.content, `%${search}%`))
  }

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
    .orderBy(
      (() => {
        const col =
          sortBy === 'tokenCount'
            ? embedding.tokenCount
            : sortBy === 'enabled'
              ? embedding.enabled
              : embedding.chunkIndex
        return sortOrder === 'desc' ? desc(col) : asc(col)
      })()
    )
    .limit(limit)
    .offset(offset)

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
 * Create a new chunk for a document.
 *
 * Assigns `chunkIndex` as `max(chunkIndex) + 1` under a transactional
 * `pg_advisory_xact_lock` keyed on the document, so concurrent calls for the
 * same document serialize instead of computing the same index and colliding
 * on the `(document_id, chunk_index)` unique constraint. A `SELECT ... FOR
 * UPDATE` on the current max row doesn't prevent that collision, since the
 * row it would lock is unrelated to the not-yet-inserted next row. A row
 * lock on `document` instead of an advisory lock would also work, but would
 * invert the embedding-before-document lock order every other chunk
 * mutation path uses (see lock-order.test.ts) — the advisory lock is a
 * separate namespace, so it can't deadlock against that convention.
 *
 * `pg_advisory_xact_lock` auto-releases at transaction end, so there's no
 * session lock to leak onto a pooled connection, and `lock_timeout` bounds
 * the wait (it raises SQLSTATE 55P03 instead of hanging a pooled connection)
 * if a same-document holder is stuck.
 */
export async function createChunk(
  knowledgeBaseId: string,
  documentId: string,
  docTags: Record<string, string | number | boolean | Date | null>,
  chunkData: CreateChunkData,
  requestId: string,
  workspaceId?: string | null
): Promise<ChunkData> {
  logger.info(`[${requestId}] Generating embedding for manual chunk`)
  const kbRow = await db
    .select({ embeddingModel: knowledgeBase.embeddingModel })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)
  if (kbRow.length === 0) {
    throw new Error('Knowledge base not found')
  }
  const kbEmbeddingModel = kbRow[0].embeddingModel
  const { embeddings } = await generateEmbeddings(
    [chunkData.content],
    kbEmbeddingModel,
    workspaceId
  )

  const tokenCount = estimateTokenCount(
    chunkData.content,
    getEmbeddingModelInfo(kbEmbeddingModel).tokenizerProvider
  )

  const chunkId = generateId()
  const now = new Date()

  const newChunk = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('lock_timeout', ${`${KB_CHUNK_LOCK_TIMEOUT_MS}ms`}, true)`
    )
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`kb_chunk_seq:${documentId}`}, 0))`
    )

    const activeDocument = await tx
      .select({ id: document.id })
      .from(document)
      .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
      .where(
        and(
          eq(document.id, documentId),
          eq(document.knowledgeBaseId, knowledgeBaseId),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .limit(1)

    if (activeDocument.length === 0) {
      throw new Error('Document not found')
    }

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
      chunkHash: sha256Hex(chunkData.content),
      content: chunkData.content,
      contentLength: chunkData.content.length,
      tokenCount: tokenCount.count,
      embedding: embeddings[0],
      embeddingModel: kbEmbeddingModel,
      startOffset: 0, // Manual chunks don't have document offsets
      endOffset: chunkData.content.length,
      // Inherit text tags from parent document
      tag1: docTags.tag1 as string | null,
      tag2: docTags.tag2 as string | null,
      tag3: docTags.tag3 as string | null,
      tag4: docTags.tag4 as string | null,
      tag5: docTags.tag5 as string | null,
      tag6: docTags.tag6 as string | null,
      tag7: docTags.tag7 as string | null,
      // Inherit number tags from parent document (5 slots)
      number1: docTags.number1 as number | null,
      number2: docTags.number2 as number | null,
      number3: docTags.number3 as number | null,
      number4: docTags.number4 as number | null,
      number5: docTags.number5 as number | null,
      // Inherit date tags from parent document (2 slots)
      date1: docTags.date1 as Date | null,
      date2: docTags.date2 as Date | null,
      // Inherit boolean tags from parent document (3 slots)
      boolean1: docTags.boolean1 as boolean | null,
      boolean2: docTags.boolean2 as boolean | null,
      boolean3: docTags.boolean3 as boolean | null,
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
  requestId: string,
  workspaceId?: string | null
): Promise<ChunkData> {
  // Content updates run in a transaction to keep document statistics
  // consistent. The embedding API call happens BEFORE the transaction opens so
  // a held pooled connection never waits on external I/O; the transaction then
  // re-reads the chunk under a row lock and retries the whole flow in the rare
  // case a concurrent edit invalidated the regeneration decision.
  if (updateData.content !== undefined && typeof updateData.content === 'string') {
    const content = updateData.content
    const MAX_UPDATE_ATTEMPTS = 3

    for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
      const [preRead] = await db
        .select({ documentId: embedding.documentId, content: embedding.content })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)

      if (!preRead) {
        throw new Error(`Chunk ${chunkId} not found`)
      }

      // The embedding is a function of the new content alone, so generating it
      // outside the transaction is always valid.
      let regenerated: { embedding: number[]; tokenCount: number } | null = null
      if (content !== preRead.content) {
        const kbRow = await db
          .select({ embeddingModel: knowledgeBase.embeddingModel })
          .from(knowledgeBase)
          .innerJoin(document, eq(document.knowledgeBaseId, knowledgeBase.id))
          .where(eq(document.id, preRead.documentId))
          .limit(1)
        const chunkEmbeddingModel = kbRow[0]?.embeddingModel
        if (!chunkEmbeddingModel) {
          throw new Error('Knowledge base for chunk not found')
        }

        logger.info(`[${requestId}] Content changed, regenerating embedding for chunk ${chunkId}`)
        const { embeddings } = await generateEmbeddings([content], chunkEmbeddingModel, workspaceId)
        regenerated = {
          embedding: embeddings[0],
          tokenCount: estimateTokenCount(
            content,
            getEmbeddingModelInfo(chunkEmbeddingModel).tokenizerProvider
          ).count,
        }
      }

      const result = await db.transaction(async (tx) => {
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
          .for('update')

        if (currentChunk.length === 0) {
          throw new Error(`Chunk ${chunkId} not found`)
        }

        // A concurrent edit landed between the pre-read and this row lock and
        // we skipped regeneration based on stale content; retry so the
        // decision is re-made against the committed content.
        if (!regenerated && currentChunk[0].content !== content) {
          return null
        }

        const oldContentLength = currentChunk[0].contentLength
        const oldTokenCount = currentChunk[0].tokenCount
        const newContentLength = content.length

        const chunkUpdate = {
          updatedAt: new Date(),
          content,
          contentLength: newContentLength,
          chunkHash: sha256Hex(content),
          tokenCount: regenerated ? regenerated.tokenCount : oldTokenCount,
          ...(regenerated ? { embedding: regenerated.embedding } : {}),
          ...(updateData.enabled !== undefined ? { enabled: updateData.enabled } : {}),
        }

        await tx.update(embedding).set(chunkUpdate).where(eq(embedding.id, chunkId))

        const charDiff = newContentLength - oldContentLength
        const tokenDiff = chunkUpdate.tokenCount - oldTokenCount

        await tx
          .update(document)
          .set({
            characterCount: sql`${document.characterCount} + ${charDiff}`,
            tokenCount: sql`${document.tokenCount} + ${tokenDiff}`,
          })
          .where(eq(document.id, currentChunk[0].documentId))

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
          `[${requestId}] Updated chunk: ${chunkId}${regenerated ? ' (regenerated embedding)' : ''}`
        )

        return updatedChunk[0] as ChunkData
      })

      if (result) {
        return result
      }
    }

    throw new Error(
      `Chunk ${chunkId} was concurrently modified ${MAX_UPDATE_ATTEMPTS} times; retry the update`
    )
  }

  // If only enabled status is being updated, no need for transaction
  await db
    .update(embedding)
    .set({
      updatedAt: new Date(),
      ...(updateData.enabled !== undefined ? { enabled: updateData.enabled } : {}),
    })
    .where(eq(embedding.id, chunkId))

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
