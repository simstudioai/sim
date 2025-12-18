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
  // Text tags
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  // Number tags (5 slots)
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  // Date tags (2 slots)
  date1: Date | null
  date2: Date | null
  // Boolean tags (3 slots)
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  distance: number
  knowledgeBaseId: string
}

/** Structured filter with operator support */
export interface StructuredFilter {
  tagSlot: string
  fieldType: string
  operator: string
  value: string | number | boolean
  valueTo?: string | number
}

export interface SearchParams {
  knowledgeBaseIds: string[]
  topK: number
  filters?: Record<string, string>
  structuredFilters?: StructuredFilter[]
  queryVector?: string
  distanceThreshold?: number
}

// Use shared embedding utility
export { generateSearchEmbedding } from '@/lib/knowledge/embeddings'

/** All valid tag slot keys */
const TAG_SLOT_KEYS = [
  // Text tags (7 slots)
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  // Number tags (5 slots)
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  // Date tags (2 slots)
  'date1',
  'date2',
  // Boolean tags (3 slots)
  'boolean1',
  'boolean2',
  'boolean3',
] as const

type TagSlotKey = (typeof TAG_SLOT_KEYS)[number]

function isTagSlotKey(key: string): key is TagSlotKey {
  return TAG_SLOT_KEYS.includes(key as TagSlotKey)
}

/** Common fields selected for search results */
const getSearchResultFields = (distanceExpr: any) => ({
  id: embedding.id,
  content: embedding.content,
  documentId: embedding.documentId,
  chunkIndex: embedding.chunkIndex,
  // Text tags
  tag1: embedding.tag1,
  tag2: embedding.tag2,
  tag3: embedding.tag3,
  tag4: embedding.tag4,
  tag5: embedding.tag5,
  tag6: embedding.tag6,
  tag7: embedding.tag7,
  // Number tags (5 slots)
  number1: embedding.number1,
  number2: embedding.number2,
  number3: embedding.number3,
  number4: embedding.number4,
  number5: embedding.number5,
  // Date tags (2 slots)
  date1: embedding.date1,
  date2: embedding.date2,
  // Boolean tags (3 slots)
  boolean1: embedding.boolean1,
  boolean2: embedding.boolean2,
  boolean3: embedding.boolean3,
  distance: distanceExpr,
  knowledgeBaseId: embedding.knowledgeBaseId,
})

function getTagFilters(filters: Record<string, string>, embeddingTable: any) {
  return Object.entries(filters).map(([key, value]) => {
    // Handle OR logic within same tag
    const values = value.includes('|OR|') ? value.split('|OR|') : [value]
    logger.debug(`[getTagFilters] Processing ${key}="${value}" -> values:`, values)

    // Check if the key is a valid tag slot
    if (!isTagSlotKey(key)) {
      logger.debug(`[getTagFilters] Unknown tag slot key: ${key}`)
      return sql`1=1` // No-op for unknown keys
    }

    const column = embeddingTable[key]
    if (!column) return sql`1=1` // No-op if column doesn't exist

    // Determine if this is a text, number, date, or boolean column
    const isTextTag = key.startsWith('tag')
    const isNumberTag = key.startsWith('number')
    const isDateTag = key.startsWith('date')
    const isBooleanTag = key.startsWith('boolean')

    if (isBooleanTag) {
      // Boolean comparison
      const boolValue = values[0].toLowerCase() === 'true'
      logger.debug(`[getTagFilters] Boolean filter: ${key} = ${boolValue}`)
      return sql`${column} = ${boolValue}`
    }

    if (isNumberTag) {
      // Number comparison - for simple equality
      const numValue = Number.parseFloat(values[0])
      if (values.length === 1) {
        logger.debug(`[getTagFilters] Number filter: ${key} = ${numValue}`)
        return sql`${column} = ${numValue}`
      }
      // Multiple values - OR logic
      const numValues = values.map((v) => Number.parseFloat(v))
      logger.debug(`[getTagFilters] OR number filter: ${key} IN (${numValues.join(', ')})`)
      const orConditions = numValues.map((v) => sql`${column} = ${v}`)
      return sql`(${sql.join(orConditions, sql` OR `)})`
    }

    if (isDateTag) {
      // Date comparison - for simple equality
      const dateValue = new Date(values[0])
      if (values.length === 1) {
        logger.debug(`[getTagFilters] Date filter: ${key} = ${dateValue.toISOString()}`)
        return sql`${column} = ${dateValue}`
      }
      // Multiple values - OR logic
      const dateValues = values.map((v) => new Date(v))
      logger.debug(
        `[getTagFilters] OR date filter: ${key} IN (${dateValues.map((d) => d.toISOString()).join(', ')})`
      )
      const orConditions = dateValues.map((v) => sql`${column} = ${v}`)
      return sql`(${sql.join(orConditions, sql` OR `)})`
    }

    // Text tag - case-insensitive comparison
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

/**
 * Build SQL conditions from structured filters with operator support
 */
function getStructuredTagFilters(filters: StructuredFilter[], embeddingTable: any) {
  return filters.map((filter) => {
    const { tagSlot, fieldType, operator, value, valueTo } = filter

    if (!isTagSlotKey(tagSlot)) {
      logger.debug(`[getStructuredTagFilters] Unknown tag slot: ${tagSlot}`)
      return sql`1=1`
    }

    const column = embeddingTable[tagSlot]
    if (!column) return sql`1=1`

    logger.debug(
      `[getStructuredTagFilters] Processing ${tagSlot} (${fieldType}) ${operator} ${value}`
    )

    // Handle text operators
    if (fieldType === 'text') {
      const stringValue = String(value)
      switch (operator) {
        case 'eq':
          return sql`LOWER(${column}) = LOWER(${stringValue})`
        case 'neq':
          return sql`LOWER(${column}) != LOWER(${stringValue})`
        case 'contains':
          return sql`LOWER(${column}) LIKE LOWER(${`%${stringValue}%`})`
        case 'not_contains':
          return sql`LOWER(${column}) NOT LIKE LOWER(${`%${stringValue}%`})`
        case 'starts_with':
          return sql`LOWER(${column}) LIKE LOWER(${`${stringValue}%`})`
        case 'ends_with':
          return sql`LOWER(${column}) LIKE LOWER(${`%${stringValue}`})`
        default:
          return sql`LOWER(${column}) = LOWER(${stringValue})`
      }
    }

    // Handle number operators
    if (fieldType === 'number') {
      const numValue = typeof value === 'number' ? value : Number.parseFloat(String(value))
      switch (operator) {
        case 'eq':
          return sql`${column} = ${numValue}`
        case 'neq':
          return sql`${column} != ${numValue}`
        case 'gt':
          return sql`${column} > ${numValue}`
        case 'gte':
          return sql`${column} >= ${numValue}`
        case 'lt':
          return sql`${column} < ${numValue}`
        case 'lte':
          return sql`${column} <= ${numValue}`
        case 'between':
          if (valueTo !== undefined) {
            const numValueTo =
              typeof valueTo === 'number' ? valueTo : Number.parseFloat(String(valueTo))
            return sql`${column} >= ${numValue} AND ${column} <= ${numValueTo}`
          }
          return sql`${column} = ${numValue}`
        default:
          return sql`${column} = ${numValue}`
      }
    }

    // Handle date operators
    if (fieldType === 'date') {
      const dateValue = new Date(String(value))
      switch (operator) {
        case 'eq':
          return sql`${column} = ${dateValue}`
        case 'neq':
          return sql`${column} != ${dateValue}`
        case 'gt':
          return sql`${column} > ${dateValue}`
        case 'gte':
          return sql`${column} >= ${dateValue}`
        case 'lt':
          return sql`${column} < ${dateValue}`
        case 'lte':
          return sql`${column} <= ${dateValue}`
        case 'between':
          if (valueTo !== undefined) {
            const dateValueTo = new Date(String(valueTo))
            return sql`${column} >= ${dateValue} AND ${column} <= ${dateValueTo}`
          }
          return sql`${column} = ${dateValue}`
        default:
          return sql`${column} = ${dateValue}`
      }
    }

    // Handle boolean operators
    if (fieldType === 'boolean') {
      const boolValue = value === true || value === 'true'
      switch (operator) {
        case 'eq':
          return sql`${column} = ${boolValue}`
        case 'neq':
          return sql`${column} != ${boolValue}`
        default:
          return sql`${column} = ${boolValue}`
      }
    }

    // Fallback to equality
    return sql`${column} = ${value}`
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
  filters?: Record<string, string>,
  structuredFilters?: StructuredFilter[]
): Promise<{ id: string }[]> {
  // Use structured filters if provided, otherwise fall back to legacy filters
  const tagFilterConditions = structuredFilters
    ? getStructuredTagFilters(structuredFilters, embedding)
    : filters
      ? getTagFilters(filters, embedding)
      : []

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
          ...tagFilterConditions
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
        ...tagFilterConditions
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
    .select(
      getSearchResultFields(
        sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance')
      )
    )
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
  const { knowledgeBaseIds, topK, filters, structuredFilters } = params

  const hasLegacyFilters = filters && Object.keys(filters).length > 0
  const hasStructuredFilters = structuredFilters && structuredFilters.length > 0

  if (!hasLegacyFilters && !hasStructuredFilters) {
    throw new Error('Tag filters are required for tag-only search')
  }

  logger.debug(
    `[handleTagOnlySearch] Executing tag-only search with filters:`,
    hasStructuredFilters ? structuredFilters : filters
  )

  const strategy = getQueryStrategy(knowledgeBaseIds.length, topK)

  // Get filter conditions based on whether we have structured or legacy filters
  const tagFilterConditions = hasStructuredFilters
    ? getStructuredTagFilters(structuredFilters!, embedding)
    : getTagFilters(filters!, embedding)

  if (strategy.useParallel) {
    // Parallel approach for many KBs
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

    const queryPromises = knowledgeBaseIds.map(async (kbId) => {
      return await db
        .select(getSearchResultFields(sql<number>`0`.as('distance')))
        .from(embedding)
        .innerJoin(document, eq(embedding.documentId, document.id))
        .where(
          and(
            eq(embedding.knowledgeBaseId, kbId),
            eq(embedding.enabled, true),
            isNull(document.deletedAt),
            ...tagFilterConditions
          )
        )
        .limit(parallelLimit)
    })

    const parallelResults = await Promise.all(queryPromises)
    return parallelResults.flat().slice(0, topK)
  }
  // Single query for fewer KBs
  return await db
    .select(getSearchResultFields(sql<number>`0`.as('distance')))
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        eq(embedding.enabled, true),
        isNull(document.deletedAt),
        ...tagFilterConditions
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

  const distanceExpr = sql<number>`${embedding.embedding} <=> ${queryVector}::vector`.as('distance')

  if (strategy.useParallel) {
    // Parallel approach for many KBs
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

    const queryPromises = knowledgeBaseIds.map(async (kbId) => {
      return await db
        .select(getSearchResultFields(distanceExpr))
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
    .select(getSearchResultFields(distanceExpr))
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
  const { knowledgeBaseIds, topK, filters, structuredFilters, queryVector, distanceThreshold } =
    params

  const hasLegacyFilters = filters && Object.keys(filters).length > 0
  const hasStructuredFilters = structuredFilters && structuredFilters.length > 0

  if (!hasLegacyFilters && !hasStructuredFilters) {
    throw new Error('Tag filters are required for tag and vector search')
  }
  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for tag and vector search')
  }

  logger.debug(
    `[handleTagAndVectorSearch] Executing tag + vector search with filters:`,
    hasStructuredFilters ? structuredFilters : filters
  )

  // Step 1: Filter by tags first
  const tagFilteredIds = await executeTagFilterQuery(
    knowledgeBaseIds,
    hasLegacyFilters ? filters : undefined,
    hasStructuredFilters ? structuredFilters : undefined
  )

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
