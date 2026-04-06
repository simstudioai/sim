import { createHash } from 'crypto'
import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import { generateId } from '@/lib/core/utils/uuid'
import type {
  BatchOperationResult,
  ChunkData,
  ChunkFilters,
  ChunkQueryResult,
  CreateChunkData,
} from '@/lib/knowledge/chunks/types'
import {
  deleteKBChunkById,
  deleteKBChunksByIds,
  getKBChunkForDelete,
  getKBChunksStats,
  insertKBEmbeddings,
  kbTableName,
  parseEmbeddingModel,
  queryKBChunks,
  setKBChunksEnabled,
  updateKBChunkFields,
} from '@/lib/knowledge/dynamic-tables'
import { generateEmbeddings, getOllamaBaseUrl, isAllowedOllamaUrl } from '@/lib/knowledge/embeddings'
import { estimateTokenCount } from '@/lib/tokenization/estimators'

const logger = createLogger('ChunksService')

/**
 * Query chunks for a document with filtering and pagination.
 * Routes to the per-KB dynamic table for Ollama knowledge bases.
 */
export async function queryChunks(
  knowledgeBaseId: string,
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

  const kbRows = await db
    .select({ embeddingModel: knowledgeBase.embeddingModel })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  const { provider } = parseEmbeddingModel(kbRows[0]?.embeddingModel)

  if (provider === 'ollama') {
    const { rows, total } = await queryKBChunks(knowledgeBaseId, documentId, {
      search,
      enabled,
      limit,
      offset,
      sortBy,
      sortOrder,
    })
    logger.info(`[${requestId}] Retrieved ${rows.length} chunks for document ${documentId}`)
    return {
      chunks: rows as ChunkData[],
      pagination: { total, limit, offset, hasMore: rows.length === limit },
    }
  }

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
 * Routes to the per-KB dynamic table for Ollama knowledge bases.
 */
export async function createChunk(
  knowledgeBaseId: string,
  documentId: string,
  docTags: Record<string, string | number | boolean | Date | null>,
  chunkData: CreateChunkData,
  requestId: string,
  workspaceId?: string | null
): Promise<ChunkData> {
  // Look up KB embedding config so we use the right provider, model, and dimension
  const kbRows = await db
    .select({
      embeddingModel: knowledgeBase.embeddingModel,
      embeddingDimension: knowledgeBase.embeddingDimension,
      chunkingConfig: knowledgeBase.chunkingConfig,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kbRows.length === 0) throw new Error(`Knowledge base not found: ${knowledgeBaseId}`)

  const kbEmbeddingModel = kbRows[0].embeddingModel
  const kbDimension = (kbRows[0].embeddingDimension as number | null) ?? 768
  const rawKbCfg = kbRows[0].chunkingConfig as { ollamaBaseUrl?: string } | null
  const kbOllamaBaseUrl = rawKbCfg?.ollamaBaseUrl

  const { provider } = parseEmbeddingModel(kbEmbeddingModel)
  const isOllama = provider === 'ollama'

  if (isOllama) {
    const resolvedCreateUrl = getOllamaBaseUrl(kbOllamaBaseUrl)
    if (!isAllowedOllamaUrl(resolvedCreateUrl)) {
      throw new Error(`Knowledge base has a disallowed Ollama URL: ${resolvedCreateUrl}`)
    }
  }

  logger.info(`[${requestId}] Generating embedding for manual chunk`)
  const { embeddings, modelName: usedModel } = await generateEmbeddings(
    [chunkData.content],
    kbEmbeddingModel,
    workspaceId,
    kbOllamaBaseUrl
  )

  const tokenCount = estimateTokenCount(chunkData.content, 'openai')
  const chunkId = generateId()
  const now = new Date()

  const newChunk = await db.transaction(async (tx) => {
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

    let nextChunkIndex: number

    if (isOllama) {
      const table = kbTableName(knowledgeBaseId)
      const lastChunkRows = await tx.execute(sql`
        SELECT chunk_index
        FROM ${sql.raw(`"${table}"`)}
        WHERE document_id = ${documentId}
        ORDER BY chunk_index DESC
        LIMIT 1
      `)
      nextChunkIndex =
        lastChunkRows.length > 0
          ? Number((lastChunkRows[0] as { chunk_index: number }).chunk_index) + 1
          : 0
    } else {
      const lastChunk = await tx
        .select({ chunkIndex: embedding.chunkIndex })
        .from(embedding)
        .where(eq(embedding.documentId, documentId))
        .orderBy(sql`${embedding.chunkIndex} DESC`)
        .limit(1)
      nextChunkIndex = lastChunk.length > 0 ? lastChunk[0].chunkIndex + 1 : 0
    }

    const tagFields = {
      tag1: docTags.tag1 as string | null,
      tag2: docTags.tag2 as string | null,
      tag3: docTags.tag3 as string | null,
      tag4: docTags.tag4 as string | null,
      tag5: docTags.tag5 as string | null,
      tag6: docTags.tag6 as string | null,
      tag7: docTags.tag7 as string | null,
      number1: docTags.number1 as number | null,
      number2: docTags.number2 as number | null,
      number3: docTags.number3 as number | null,
      number4: docTags.number4 as number | null,
      number5: docTags.number5 as number | null,
      date1: docTags.date1 as Date | null,
      date2: docTags.date2 as Date | null,
      boolean1: docTags.boolean1 as boolean | null,
      boolean2: docTags.boolean2 as boolean | null,
      boolean3: docTags.boolean3 as boolean | null,
    }

    if (isOllama) {
      await insertKBEmbeddings(
        knowledgeBaseId,
        [
          {
            id: chunkId,
            knowledgeBaseId,
            documentId,
            chunkIndex: nextChunkIndex,
            chunkHash: createHash('sha256').update(chunkData.content).digest('hex'),
            content: chunkData.content,
            contentLength: chunkData.content.length,
            tokenCount: tokenCount.count,
            embedding: embeddings[0],
            embeddingModel: usedModel,
            startOffset: 0,
            endOffset: chunkData.content.length,
            ...tagFields,
            enabled: chunkData.enabled ?? true,
            createdAt: now,
            updatedAt: now,
          },
        ],
        kbDimension,
        tx
      )
    } else {
      await tx.insert(embedding).values({
        id: chunkId,
        knowledgeBaseId,
        documentId,
        chunkIndex: nextChunkIndex,
        chunkHash: createHash('sha256').update(chunkData.content).digest('hex'),
        content: chunkData.content,
        contentLength: chunkData.content.length,
        tokenCount: tokenCount.count,
        embedding: embeddings[0],
        embeddingModel: usedModel,
        startOffset: 0,
        endOffset: chunkData.content.length,
        ...tagFields,
        enabled: chunkData.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      })
    }

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
 * Perform batch operations on chunks.
 * Routes to the per-KB dynamic table for Ollama knowledge bases.
 */
export async function batchChunkOperation(
  knowledgeBaseId: string,
  documentId: string,
  operation: 'enable' | 'disable' | 'delete',
  chunkIds: string[],
  requestId: string
): Promise<BatchOperationResult> {
  logger.info(
    `[${requestId}] Starting batch ${operation} operation on ${chunkIds.length} chunks for document ${documentId}`
  )

  const kbRows = await db
    .select({ embeddingModel: knowledgeBase.embeddingModel })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  const { provider } = parseEmbeddingModel(kbRows[0]?.embeddingModel)
  const isOllama = provider === 'ollama'

  const errors: string[] = []
  let successCount = 0

  if (operation === 'delete') {
    await db.transaction(async (tx) => {
      if (isOllama) {
        const stats = await getKBChunksStats(knowledgeBaseId, documentId, chunkIds, tx)
        if (stats.length === 0) {
          errors.push('No matching chunks found to delete')
          return
        }

        const totalTokensToRemove = stats.reduce((sum, c) => sum + c.tokenCount, 0)
        const totalCharsToRemove = stats.reduce((sum, c) => sum + c.contentLength, 0)

        await deleteKBChunksByIds(knowledgeBaseId, documentId, chunkIds, tx)

        await tx
          .update(document)
          .set({
            chunkCount: sql`${document.chunkCount} - ${stats.length}`,
            tokenCount: sql`${document.tokenCount} - ${totalTokensToRemove}`,
            characterCount: sql`${document.characterCount} - ${totalCharsToRemove}`,
          })
          .where(eq(document.id, documentId))

        successCount = stats.length
      } else {
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
        const totalCharsToRemove = chunksToDelete.reduce(
          (sum, chunk) => sum + chunk.contentLength,
          0
        )

        await tx
          .delete(embedding)
          .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))

        await tx
          .update(document)
          .set({
            chunkCount: sql`${document.chunkCount} - ${chunksToDelete.length}`,
            tokenCount: sql`${document.tokenCount} - ${totalTokensToRemove}`,
            characterCount: sql`${document.characterCount} - ${totalCharsToRemove}`,
          })
          .where(eq(document.id, documentId))

        successCount = chunksToDelete.length
      }
    })
  } else {
    const enabled = operation === 'enable'

    if (isOllama) {
      await setKBChunksEnabled(knowledgeBaseId, documentId, chunkIds, enabled)
    } else {
      await db
        .update(embedding)
        .set({ enabled, updatedAt: new Date() })
        .where(and(eq(embedding.documentId, documentId), inArray(embedding.id, chunkIds)))
    }

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
 * Update a single chunk.
 * Routes to the per-KB dynamic table for Ollama knowledge bases.
 */
export async function updateChunk(
  knowledgeBaseId: string,
  chunkId: string,
  updateData: {
    content?: string
    enabled?: boolean
  },
  requestId: string,
  workspaceId?: string | null
): Promise<ChunkData> {
  // Fetch KB config upfront — needed for provider routing and embedding regeneration
  const kbRows = await db
    .select({
      embeddingModel: knowledgeBase.embeddingModel,
      chunkingConfig: knowledgeBase.chunkingConfig,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kbRows.length === 0) throw new Error(`Knowledge base not found: ${knowledgeBaseId}`)

  const kbEmbeddingModel = kbRows[0].embeddingModel
  const rawCfg = kbRows[0].chunkingConfig as { ollamaBaseUrl?: string } | null
  const kbOllamaBaseUrl = rawCfg?.ollamaBaseUrl

  const { provider } = parseEmbeddingModel(kbEmbeddingModel)
  const isOllama = provider === 'ollama'
  const tableName = isOllama ? kbTableName(knowledgeBaseId) : null

  if (isOllama) {
    const resolvedUpdateUrl = getOllamaBaseUrl(kbOllamaBaseUrl)
    if (!isAllowedOllamaUrl(resolvedUpdateUrl)) {
      throw new Error(`Knowledge base has a disallowed Ollama URL: ${resolvedUpdateUrl}`)
    }
  }

  // Content update path — needs a transaction for atomic stat updates
  if (updateData.content !== undefined && typeof updateData.content === 'string') {
    return await db.transaction(async (tx) => {
      let docId: string
      let oldContent: string
      let oldContentLength: number
      let oldTokenCount: number

      if (isOllama && tableName) {
        const rows = await tx.execute(sql`
          SELECT document_id, content, content_length, token_count
          FROM ${sql.raw(`"${tableName}"`)}
          WHERE id = ${chunkId}
          LIMIT 1
        `)
        if (rows.length === 0) throw new Error(`Chunk ${chunkId} not found`)
        const r = rows[0] as {
          document_id: string
          content: string
          content_length: number
          token_count: number
        }
        docId = r.document_id
        oldContent = r.content
        oldContentLength = r.content_length
        oldTokenCount = r.token_count
      } else {
        const rows = await tx
          .select({
            documentId: embedding.documentId,
            content: embedding.content,
            contentLength: embedding.contentLength,
            tokenCount: embedding.tokenCount,
          })
          .from(embedding)
          .where(eq(embedding.id, chunkId))
          .limit(1)
        if (rows.length === 0) throw new Error(`Chunk ${chunkId} not found`)
        docId = rows[0].documentId
        oldContent = rows[0].content
        oldContentLength = rows[0].contentLength
        oldTokenCount = rows[0].tokenCount
      }

      const content = updateData.content!
      const newContentLength = content.length
      let newTokenCount = oldTokenCount
      let newEmbedding: number[] | undefined

      if (content !== oldContent) {
        logger.info(`[${requestId}] Content changed, regenerating embedding for chunk ${chunkId}`)
        const { embeddings } = await generateEmbeddings(
          [content],
          kbEmbeddingModel,
          workspaceId,
          kbOllamaBaseUrl
        )
        newEmbedding = embeddings[0]
        newTokenCount = estimateTokenCount(content, 'openai').count
      }

      const newHash = createHash('sha256').update(content).digest('hex')

      if (isOllama && tableName) {
        await updateKBChunkFields(
          knowledgeBaseId,
          chunkId,
          {
            content,
            contentLength: newContentLength,
            tokenCount: newTokenCount,
            chunkHash: newHash,
            embedding: newEmbedding,
            enabled: updateData.enabled,
          },
          tx
        )
      } else {
        const dbData: Record<string, unknown> = {
          updatedAt: new Date(),
          content,
          contentLength: newContentLength,
          tokenCount: newTokenCount,
          chunkHash: newHash,
        }
        if (newEmbedding !== undefined) dbData.embedding = newEmbedding
        if (updateData.enabled !== undefined) dbData.enabled = updateData.enabled
        await tx.update(embedding).set(dbData).where(eq(embedding.id, chunkId))
      }

      const charDiff = newContentLength - oldContentLength
      const tokenDiff = newTokenCount - oldTokenCount
      await tx
        .update(document)
        .set({
          characterCount: sql`${document.characterCount} + ${charDiff}`,
          tokenCount: sql`${document.tokenCount} + ${tokenDiff}`,
        })
        .where(eq(document.id, docId))

      logger.info(
        `[${requestId}] Updated chunk: ${chunkId}${content !== oldContent ? ' (regenerated embedding)' : ''}`
      )

      if (isOllama && tableName) {
        const rows = await tx.execute(sql`
          SELECT id::text, chunk_index AS "chunkIndex", content,
                 content_length AS "contentLength", token_count AS "tokenCount",
                 enabled, start_offset AS "startOffset", end_offset AS "endOffset",
                 tag1, tag2, tag3, tag4, tag5, tag6, tag7,
                 created_at AS "createdAt", updated_at AS "updatedAt"
          FROM ${sql.raw(`"${tableName}"`)}
          WHERE id = ${chunkId}
          LIMIT 1
        `)
        return rows[0] as ChunkData
      }

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

      return updatedChunk[0] as ChunkData
    })
  }

  // Enabled-only update path — no transaction needed
  if (updateData.enabled !== undefined) {
    if (isOllama && tableName) {
      await db.execute(sql`
        UPDATE ${sql.raw(`"${tableName}"`)}
        SET enabled = ${updateData.enabled}, updated_at = NOW()
        WHERE id = ${chunkId}
      `)
    } else {
      await db
        .update(embedding)
        .set({ enabled: updateData.enabled, updatedAt: new Date() })
        .where(eq(embedding.id, chunkId))
    }
  }

  // Fetch and return current state
  if (isOllama && tableName) {
    const rows = await db.execute(sql`
      SELECT id::text, chunk_index AS "chunkIndex", content,
             content_length AS "contentLength", token_count AS "tokenCount",
             enabled, start_offset AS "startOffset", end_offset AS "endOffset",
             tag1, tag2, tag3, tag4, tag5, tag6, tag7,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM ${sql.raw(`"${tableName}"`)}
      WHERE id = ${chunkId}
      LIMIT 1
    `)
    if (rows.length === 0) throw new Error(`Chunk ${chunkId} not found`)
    logger.info(`[${requestId}] Updated chunk: ${chunkId}`)
    return rows[0] as ChunkData
  }

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
 * Delete a single chunk with document statistics updates.
 * Routes to the per-KB dynamic table for Ollama knowledge bases.
 */
export async function deleteChunk(
  knowledgeBaseId: string,
  chunkId: string,
  documentId: string,
  requestId: string
): Promise<void> {
  const kbRows = await db
    .select({ embeddingModel: knowledgeBase.embeddingModel })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  const { provider } = parseEmbeddingModel(kbRows[0]?.embeddingModel)
  const isOllama = provider === 'ollama'

  await db.transaction(async (tx) => {
    if (isOllama) {
      const stats = await getKBChunkForDelete(knowledgeBaseId, chunkId, documentId, tx)
      if (!stats) throw new Error('Chunk not found')

      await deleteKBChunkById(knowledgeBaseId, chunkId, tx)

      await tx
        .update(document)
        .set({
          chunkCount: sql`${document.chunkCount} - 1`,
          tokenCount: sql`${document.tokenCount} - ${stats.tokenCount}`,
          characterCount: sql`${document.characterCount} - ${stats.contentLength}`,
        })
        .where(eq(document.id, documentId))
    } else {
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

      await tx.delete(embedding).where(eq(embedding.id, chunkId))

      await tx
        .update(document)
        .set({
          chunkCount: sql`${document.chunkCount} - 1`,
          tokenCount: sql`${document.tokenCount} - ${chunk.tokenCount}`,
          characterCount: sql`${document.characterCount} - ${chunk.contentLength}`,
        })
        .where(eq(document.id, documentId))
    }
  })

  logger.info(`[${requestId}] Deleted chunk: ${chunkId}`)
}
