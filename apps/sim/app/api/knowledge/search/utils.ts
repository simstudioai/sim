import { db } from '@sim/db'
import { document, embedding } from '@sim/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('KnowledgeSearchUtils')

export async function getDocumentNamesByIds(
  documentIds: string[]
): Promise<Record<string, string>> {
  if (documentIds.length === 0) {
    return {}
  }

  const uniqueIds = [...new Set(documentIds)]
  const documents = await db
    .select({
      id: document.id,
      filename: document.filename,
    })
    .from(document)
    .where(and(inArray(document.id, uniqueIds), isNull(document.deletedAt)))

  const documentNameMap: Record<string, string> = {}
  documents.forEach((doc) => {
    documentNameMap[doc.id] = doc.filename
  })

  return documentNameMap
}

export interface SearchResult {
  id: string
  content: string
  documentId: string
  chunkIndex: number
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  distance: number
  knowledgeBaseId: string
}

export interface SearchParams {
  knowledgeBaseIds: string[]
  topK: number
  filters?: Record<string, string>
  queryVector?: string
  distanceThreshold?: number
}

// Use shared embedding utility
export { generateSearchEmbedding } from '@/lib/embeddings/utils'

function getTagFilters(filters: Record<string, string>, embedding: any) {
  return Object.entries(filters).map(([key, value]) => {
    // Handle OR logic within same tag
    const values = value.includes('|OR|') ? value.split('|OR|') : [value]
    logger.debug(`[getTagFilters] Processing ${key}="${value}" -> values:`, values)

    const getColumnForKey = (key: string) => {
      switch (key) {
        case 'tag1':
          return embedding.tag1
        case 'tag2':
          return embedding.tag2
        case 'tag3':
          return embedding.tag3
        case 'tag4':
          return embedding.tag4
        case 'tag5':
          return embedding.tag5
        case 'tag6':
          return embedding.tag6
        case 'tag7':
          return embedding.tag7
        default:
          return null
      }
    }

    const column = getColumnForKey(key)
    if (!column) return sql`1=1` // No-op for unknown keys

    if (values.length === 1) {
      // Single value - simple equality
      logger.debug(`[getTagFilters] Single value filter: ${key} = ${values[0]}`)
      return sql`LOWER(${column}) = LOWER(${values[0]})`
    }
    // Multiple values - OR logic
    logger.debug(`[getTagFilters] OR filter: ${key} IN (${values.join(', ')})`)
    const orConditions = values.map((v) => sql`LOWER(${column}) = LOWER(${v})`)
    return sql`(${sql.join(orConditions, sql` OR `)})`
  })
}

export function getQueryStrategy(kbCount: number, topK: number) {
  const useParallel = kbCount > 4 || (kbCount > 2 && topK > 50)
  const distanceThreshold = kbCount > 3 ? 0.8 : 1.0
  const parallelLimit = Math.ceil(topK / kbCount) + 5

  return {
    useParallel,
    distanceThreshold,
    parallelLimit,
    singleQueryOptimized: kbCount <= 2,
  }
}

async function executeTagFilterQuery(
  knowledgeBaseIds: string[],
  filters: Record<string, string>
): Promise<{ id: string }[]> {
  if (knowledgeBaseIds.length === 1) {
    return await db
      .select({ id: embedding.id })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          eq(embedding.knowledgeBaseId, knowledgeBaseIds[0]),
          eq(embedding.enabled, true),
          isNull(document.deletedAt),
          ...getTagFilters(filters, embedding)
        )
      )
  }
  return await db
    .select({ id: embedding.id })
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        isNull(document.deletedAt),
        ...getTagFilters(filters, embedding)
      )
    )
}

async function executeVectorSearchOnIds(
  embeddingIds: string[],
  queryVector: string,
  topK: number,
  distanceThreshold: number
): Promise<SearchResult[]> {
  if (embeddingIds.length === 0) {
    return []
  }

  return await db
    .select({
      id: embedding.id,
      content: embedding.content,
      documentId: embedding.documentId,
      chunkIndex: embedding.chunkIndex,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
      knowledgeBaseId: embedding.knowledgeBaseId,
    })
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(
      and(
        inArray(embedding.id, embeddingIds),
        isNull(document.deletedAt),
        sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`
      )
    )
    .orderBy(sql`${embedding.embedding} <=> ${queryVector}::vector`)
    .limit(topK)
}

export async function handleTagOnlySearch(params: SearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, filters } = params

  if (!filters || Object.keys(filters).length === 0) {
    throw new Error('Tag filters are required for tag-only search')
  }

  logger.debug(`[handleTagOnlySearch] Executing tag-only search with filters:`, filters)

  const strategy = getQueryStrategy(knowledgeBaseIds.length, topK)

  if (strategy.useParallel) {
    // Parallel approach for many KBs
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

    const queryPromises = knowledgeBaseIds.map(async (kbId) => {
      return await db
        .select({
          id: embedding.id,
          content: embedding.content,
          documentId: embedding.documentId,
          chunkIndex: embedding.chunkIndex,
          tag1: embedding.tag1,
          tag2: embedding.tag2,
          tag3: embedding.tag3,
          tag4: embedding.tag4,
          tag5: embedding.tag5,
          tag6: embedding.tag6,
          tag7: embedding.tag7,
          distance: sql<number>`0`.as('distance'), // No distance for tag-only searches
          knowledgeBaseId: embedding.knowledgeBaseId,
        })
        .from(embedding)
        .innerJoin(document, eq(embedding.documentId, document.id))
        .where(
          and(
            eq(embedding.knowledgeBaseId, kbId),
            eq(embedding.enabled, true),
            isNull(document.deletedAt),
            ...getTagFilters(filters, embedding)
          )
        )
        .limit(parallelLimit)
    })

    const parallelResults = await Promise.all(queryPromises)
    return parallelResults.flat().slice(0, topK)
  }
  // Single query for fewer KBs
  return await db
    .select({
      id: embedding.id,
      content: embedding.content,
      documentId: embedding.documentId,
      chunkIndex: embedding.chunkIndex,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      distance: sql<number>`0`.as('distance'), // No distance for tag-only searches
      knowledgeBaseId: embedding.knowledgeBaseId,
    })
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        isNull(document.deletedAt),
        ...getTagFilters(filters, embedding)
      )
    )
    .limit(topK)
}

export async function handleVectorOnlySearch(params: SearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, queryVector, distanceThreshold } = params

  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for vector-only search')
  }

  logger.debug(`[handleVectorOnlySearch] Executing vector-only search`)

  const strategy = getQueryStrategy(knowledgeBaseIds.length, topK)

  if (strategy.useParallel) {
    // Parallel approach for many KBs
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

    const queryPromises = knowledgeBaseIds.map(async (kbId) => {
      return await db
        .select({
          id: embedding.id,
          content: embedding.content,
          documentId: embedding.documentId,
          chunkIndex: embedding.chunkIndex,
          tag1: embedding.tag1,
          tag2: embedding.tag2,
          tag3: embedding.tag3,
          tag4: embedding.tag4,
          tag5: embedding.tag5,
          tag6: embedding.tag6,
          tag7: embedding.tag7,
          distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
          knowledgeBaseId: embedding.knowledgeBaseId,
        })
        .from(embedding)
        .innerJoin(document, eq(embedding.documentId, document.id))
        .where(
          and(
            eq(embedding.knowledgeBaseId, kbId),
            eq(embedding.enabled, true),
            isNull(document.deletedAt),
            sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`
          )
        )
        .orderBy(sql`${embedding.embedding} <=> ${queryVector}::vector`)
        .limit(parallelLimit)
    })

    const parallelResults = await Promise.all(queryPromises)
    const allResults = parallelResults.flat()
    return allResults.sort((a, b) => a.distance - b.distance).slice(0, topK)
  }
  // Single query for fewer KBs
  return await db
    .select({
      id: embedding.id,
      content: embedding.content,
      documentId: embedding.documentId,
      chunkIndex: embedding.chunkIndex,
      tag1: embedding.tag1,
      tag2: embedding.tag2,
      tag3: embedding.tag3,
      tag4: embedding.tag4,
      tag5: embedding.tag5,
      tag6: embedding.tag6,
      tag7: embedding.tag7,
      distance: sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance'),
      knowledgeBaseId: embedding.knowledgeBaseId,
    })
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        isNull(document.deletedAt),
        sql`${embedding.embedding} <=> ${queryVector}::vector < ${distanceThreshold}`
      )
    )
    .orderBy(sql`${embedding.embedding} <=> ${queryVector}::vector`)
    .limit(topK)
}

export async function handleTagAndVectorSearch(params: SearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, filters, queryVector, distanceThreshold } = params

  if (!filters || Object.keys(filters).length === 0) {
    throw new Error('Tag filters are required for tag and vector search')
  }
  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for tag and vector search')
  }

  logger.debug(`[handleTagAndVectorSearch] Executing tag + vector search with filters:`, filters)

  // Step 1: Filter by tags first
  const tagFilteredIds = await executeTagFilterQuery(knowledgeBaseIds, filters)

  if (tagFilteredIds.length === 0) {
    logger.debug(`[handleTagAndVectorSearch] No results found after tag filtering`)
    return []
  }

  logger.debug(
    `[handleTagAndVectorSearch] Found ${tagFilteredIds.length} results after tag filtering`
  )

  // Step 2: Perform vector search only on tag-filtered results
  return await executeVectorSearchOnIds(
    tagFilteredIds.map((r) => r.id),
    queryVector,
    topK,
    distanceThreshold
  )
}
