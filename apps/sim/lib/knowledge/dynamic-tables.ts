import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { ALL_TAG_SLOTS, type AllTagSlot } from '@/lib/knowledge/constants'
import type { StructuredFilter } from '@/lib/knowledge/types'
import type { SearchResult } from '@/app/api/knowledge/search/utils'

const logger = createLogger('DynamicKBTables')

function isTagSlotKey(key: string): key is AllTagSlot {
  return (ALL_TAG_SLOTS as readonly string[]).includes(key)
}

/** Convert a KB UUID to a valid Postgres table name */
export function kbTableName(kbId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(kbId)) {
    throw new Error(`Invalid knowledge base ID: "${kbId}". Must be a UUID.`)
  }
  return `kb_embeddings_${kbId.replace(/-/g, '_')}`
}

/** Parse provider and model name from an embedding model string like 'ollama/nomic-embed-text' */
export function parseEmbeddingModel(embeddingModel: string | null | undefined): {
  provider: 'openai' | 'ollama'
  modelName: string
} {
  if (embeddingModel?.startsWith('ollama/')) {
    return { provider: 'ollama', modelName: embeddingModel.slice(7) }
  }
  return { provider: 'openai', modelName: embeddingModel || 'text-embedding-3-small' }
}

/** Create a dedicated embedding table for a knowledge base with the exact vector dimension */
export async function createKBEmbeddingTable(kbId: string, dimension: number): Promise<void> {
  const safeDimension = Math.trunc(dimension)
  if (!Number.isFinite(safeDimension) || safeDimension < 64 || safeDimension > 8192) {
    throw new Error(
      `Invalid embedding dimension: ${dimension}. Must be an integer between 64 and 8192.`
    )
  }
  const table = kbTableName(kbId)
  logger.info(`Creating per-KB embedding table: ${table} (${safeDimension}d)`)

  await db.execute(
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${table}" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        knowledge_base_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        content_length INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        embedding vector(${safeDimension}) NOT NULL,
        embedding_model TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        tag1 TEXT, tag2 TEXT, tag3 TEXT, tag4 TEXT, tag5 TEXT, tag6 TEXT, tag7 TEXT,
        number1 DOUBLE PRECISION, number2 DOUBLE PRECISION, number3 DOUBLE PRECISION, number4 DOUBLE PRECISION, number5 DOUBLE PRECISION,
        date1 TIMESTAMP, date2 TIMESTAMP,
        boolean1 BOOLEAN, boolean2 BOOLEAN, boolean3 BOOLEAN,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
  )

  await db.execute(
    sql.raw(`
      CREATE INDEX IF NOT EXISTS "${table}_hnsw"
        ON "${table}" USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `)
  )

  await db.execute(
    sql.raw(`
      CREATE INDEX IF NOT EXISTS "${table}_enabled"
        ON "${table}" (knowledge_base_id, enabled)
    `)
  )

  logger.info(`Created per-KB embedding table: ${table}`)
}

/** Drop a per-KB embedding table when the knowledge base is deleted */
export async function dropKBEmbeddingTable(kbId: string): Promise<void> {
  const table = kbTableName(kbId)
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}"`))
  logger.info(`Dropped per-KB embedding table: ${table}`)
}

/** Delete all embeddings for a document from a per-KB table (used before re-insert) */
export async function deleteKBDocumentEmbeddings(
  kbId: string,
  documentId: string,
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<void> {
  const table = kbTableName(kbId)
  await txOrDb.execute(sql`DELETE FROM ${sql.raw(`"${table}"`)} WHERE document_id = ${documentId}`)
}

export interface KBEmbeddingRecord {
  id: string
  knowledgeBaseId: string
  documentId: string
  chunkIndex: number
  chunkHash: string
  content: string
  contentLength: number
  tokenCount: number
  embedding: number[]
  embeddingModel: string
  startOffset: number | null
  endOffset: number | null
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
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

/** Validate embedding values — reject NaN/Infinity which pgvector cannot store */
function validateEmbedding(embedding: number[], chunkIndex: number): void {
  for (let i = 0; i < embedding.length; i++) {
    if (!Number.isFinite(embedding[i])) {
      throw new Error(
        `Invalid embedding value at chunk ${chunkIndex}, dimension ${i}: ${embedding[i]}. ` +
          `Embedding vectors must contain only finite numbers.`
      )
    }
  }
}

/**
 * Create a dynamic table schema for a per-KB embedding table.
 * This allows drizzle to properly handle vector serialization.
 * @param tableName - The name of the table
 * @param dimensions - The vector dimension (e.g., 768 for Ollama nomic-embed-text)
 */
function createDynamicKBTable(tableName: string, dimensions: number) {
  return pgTable(tableName, {
    id: uuid('id').primaryKey(),
    knowledgeBaseId: text('knowledge_base_id').notNull(),
    documentId: text('document_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    chunkHash: text('chunk_hash').notNull(),
    content: text('content').notNull(),
    contentLength: integer('content_length').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions }),
    embeddingModel: text('embedding_model').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    tag1: text('tag1'),
    tag2: text('tag2'),
    tag3: text('tag3'),
    tag4: text('tag4'),
    tag5: text('tag5'),
    tag6: text('tag6'),
    tag7: text('tag7'),
    number1: doublePrecision('number1'),
    number2: doublePrecision('number2'),
    number3: doublePrecision('number3'),
    number4: doublePrecision('number4'),
    number5: doublePrecision('number5'),
    date1: timestamp('date1'),
    date2: timestamp('date2'),
    boolean1: boolean('boolean1'),
    boolean2: boolean('boolean2'),
    boolean3: boolean('boolean3'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  })
}

/** Insert embedding records into a per-KB table in batches */
export async function insertKBEmbeddings(
  kbId: string,
  records: KBEmbeddingRecord[],
  dimension = 768,
  txOrDb: Pick<typeof db, 'insert'> = db
): Promise<void> {
  if (records.length === 0) return

  const table = kbTableName(kbId)
  const BATCH = 100

  // Create a dynamic table schema so drizzle can properly serialize vectors
  const dynamicTable = createDynamicKBTable(table, dimension)

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)

    try {
      // Validate all embeddings before insertion
      for (const r of batch) {
        if (!Array.isArray(r.embedding) || r.embedding.length === 0) {
          throw new Error(
            `Missing or empty embedding for chunk ${r.chunkIndex} in document ${r.documentId}`
          )
        }
        validateEmbedding(r.embedding, r.chunkIndex)
      }

      // Use drizzle's insert API with dynamic table schema
      await txOrDb.insert(dynamicTable).values(batch)
    } catch (err: unknown) {
      const pg = err as { code?: string; detail?: string; message?: string; cause?: unknown }
      logger.error(`insertKBEmbeddings failed for table ${table}`, {
        code: pg.code,
        detail: pg.detail,
        message: pg.message,
        cause: pg.cause,
        batchSize: batch.length,
        sampleEmbeddingDim: batch[0]?.embedding?.length,
      })
      throw err
    }
  }
}

/** Vector similarity search against a per-KB table with optional tag filters */
export async function searchKBTable(
  kbId: string,
  queryVector: string,
  topK: number,
  distanceThreshold: number,
  structuredFilters?: StructuredFilter[]
): Promise<SearchResult[]> {
  const table = kbTableName(kbId)
  const tableRef = sql.raw(`"${table}"`)

  const filterConditions = buildRawFilterConditions(structuredFilters ?? [])

  const vecParam = sql`${queryVector}::vector`

  const allConditions = [
    sql`e.knowledge_base_id = ${kbId}`,
    sql`e.enabled = TRUE`,
    sql`e.embedding <=> ${vecParam} < ${distanceThreshold}`,
    sql`d.deleted_at IS NULL`,
    sql`d.archived_at IS NULL`,
    sql`d.enabled = TRUE`,
    sql`d.processing_status = 'completed'`,
    sql`d.user_excluded = FALSE`,
    ...filterConditions,
  ]

  const whereClause = sql.join(allConditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      e.id::text,
      e.content,
      e.document_id AS "documentId",
      e.chunk_index AS "chunkIndex",
      e.tag1, e.tag2, e.tag3, e.tag4, e.tag5, e.tag6, e.tag7,
      e.number1::float8, e.number2::float8, e.number3::float8, e.number4::float8, e.number5::float8,
      e.date1, e.date2,
      e.boolean1, e.boolean2, e.boolean3,
      (e.embedding <=> ${vecParam})::float8 AS distance,
      e.knowledge_base_id AS "knowledgeBaseId"
    FROM ${tableRef} e
    INNER JOIN document d ON d.id = e.document_id
    WHERE ${whereClause}
    ORDER BY distance
    LIMIT ${topK}
  `)

  return result as unknown as SearchResult[]
}

// ─── Per-KB chunk management helpers ────────────────────────────────────────

/**
 * Query chunks from a per-KB table with filtering and pagination.
 * Returns rows without the embedding vector column.
 */
export async function queryKBChunks(
  kbId: string,
  documentId: string,
  filters: {
    search?: string
    enabled?: string
    limit: number
    offset: number
    sortBy: string
    sortOrder: string
  }
): Promise<{ rows: unknown[]; total: number }> {
  const { search, enabled = 'all', limit, offset, sortBy = 'chunkIndex', sortOrder = 'asc' } = filters
  const table = kbTableName(kbId)

  const conditions: ReturnType<typeof sql>[] = [sql`document_id = ${documentId}`]
  if (enabled === 'true') conditions.push(sql`enabled = TRUE`)
  else if (enabled === 'false') conditions.push(sql`enabled = FALSE`)
  if (search) conditions.push(sql`content ILIKE ${'%' + search + '%'}`)

  const colMap: Record<string, string> = {
    chunkIndex: 'chunk_index',
    tokenCount: 'token_count',
    enabled: 'enabled',
  }
  const sortCol = colMap[sortBy] ?? 'chunk_index'
  const dir = sortOrder === 'desc' ? 'DESC' : 'ASC'
  const whereClause = sql.join(conditions, sql` AND `)

  const rows = await db.execute(sql`
    SELECT
      id::text, chunk_index AS "chunkIndex", content,
      content_length AS "contentLength", token_count AS "tokenCount",
      enabled, start_offset AS "startOffset", end_offset AS "endOffset",
      tag1, tag2, tag3, tag4, tag5, tag6, tag7,
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM ${sql.raw(`"${table}"`)}
    WHERE ${whereClause}
    ORDER BY ${sql.raw(sortCol)} ${sql.raw(dir)}
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM ${sql.raw(`"${table}"`)} WHERE ${whereClause}
  `)

  return { rows, total: Number((countRows[0] as Record<string, unknown>)?.count ?? 0) }
}

/**
 * Fetch a single chunk row from a per-KB table for access checks.
 * Excludes the embedding vector column.
 */
export async function getKBChunk(
  kbId: string,
  chunkId: string,
  documentId: string
): Promise<unknown | null> {
  const table = kbTableName(kbId)
  const rows = await db.execute(sql`
    SELECT
      id::text, knowledge_base_id AS "knowledgeBaseId", document_id AS "documentId",
      chunk_index AS "chunkIndex", chunk_hash AS "chunkHash", content,
      content_length AS "contentLength", token_count AS "tokenCount",
      embedding_model AS "embeddingModel",
      start_offset AS "startOffset", end_offset AS "endOffset",
      tag1, tag2, tag3, tag4, tag5, tag6, tag7,
      number1::float8, number2::float8, number3::float8, number4::float8, number5::float8,
      date1, date2, boolean1, boolean2, boolean3,
      enabled, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM ${sql.raw(`"${table}"`)}
    WHERE id = ${chunkId} AND document_id = ${documentId}
    LIMIT 1
  `)
  return rows[0] ?? null
}

/**
 * Get tokenCount and contentLength for specific chunks in a per-KB table.
 * Used to compute document statistic deltas before deletion.
 */
export async function getKBChunksStats(
  kbId: string,
  documentId: string,
  chunkIds: string[],
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<Array<{ tokenCount: number; contentLength: number }>> {
  if (chunkIds.length === 0) return []
  const table = kbTableName(kbId)
  const idsFragment = sql.join(
    chunkIds.map((id) => sql`${id}`),
    sql`, `
  )
  const rows = await txOrDb.execute(sql`
    SELECT token_count AS "tokenCount", content_length AS "contentLength"
    FROM ${sql.raw(`"${table}"`)}
    WHERE document_id = ${documentId} AND id IN (${idsFragment})
  `)
  return rows as unknown as Array<{ tokenCount: number; contentLength: number }>
}

/**
 * Get a single chunk's stats from a per-KB table.
 * Used to compute document statistic deltas before single-chunk deletion.
 */
export async function getKBChunkForDelete(
  kbId: string,
  chunkId: string,
  documentId: string,
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<{ tokenCount: number; contentLength: number } | null> {
  const table = kbTableName(kbId)
  const rows = await txOrDb.execute(sql`
    SELECT token_count AS "tokenCount", content_length AS "contentLength"
    FROM ${sql.raw(`"${table}"`)}
    WHERE id = ${chunkId} AND document_id = ${documentId}
    LIMIT 1
  `)
  if (rows.length === 0) return null
  return rows[0] as { tokenCount: number; contentLength: number }
}

/**
 * Delete specific chunks from a per-KB table.
 */
export async function deleteKBChunksByIds(
  kbId: string,
  documentId: string,
  chunkIds: string[],
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<void> {
  if (chunkIds.length === 0) return
  const table = kbTableName(kbId)
  const idsFragment = sql.join(
    chunkIds.map((id) => sql`${id}`),
    sql`, `
  )
  await txOrDb.execute(sql`
    DELETE FROM ${sql.raw(`"${table}"`)}
    WHERE document_id = ${documentId} AND id IN (${idsFragment})
  `)
}

/**
 * Delete a single chunk from a per-KB table.
 */
export async function deleteKBChunkById(
  kbId: string,
  chunkId: string,
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<void> {
  const table = kbTableName(kbId)
  await txOrDb.execute(sql`
    DELETE FROM ${sql.raw(`"${table}"`)} WHERE id = ${chunkId}
  `)
}

/**
 * Enable or disable specific chunks in a per-KB table.
 */
export async function setKBChunksEnabled(
  kbId: string,
  documentId: string,
  chunkIds: string[],
  enabled: boolean,
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<void> {
  if (chunkIds.length === 0) return
  const table = kbTableName(kbId)
  const idsFragment = sql.join(
    chunkIds.map((id) => sql`${id}`),
    sql`, `
  )
  await txOrDb.execute(sql`
    UPDATE ${sql.raw(`"${table}"`)}
    SET enabled = ${enabled}, updated_at = NOW()
    WHERE document_id = ${documentId} AND id IN (${idsFragment})
  `)
}

/**
 * Update mutable fields of a single chunk in a per-KB table.
 * Pass an `embedding` array to also update the stored vector via a string cast,
 * which avoids the need to know the table's declared dimension.
 */
export async function updateKBChunkFields(
  kbId: string,
  chunkId: string,
  fields: {
    content?: string
    contentLength?: number
    tokenCount?: number
    chunkHash?: string
    embedding?: number[]
    enabled?: boolean
  },
  txOrDb: Pick<typeof db, 'execute'> = db
): Promise<void> {
  const table = kbTableName(kbId)
  const sets: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`]

  if (fields.content !== undefined) sets.push(sql`content = ${fields.content}`)
  if (fields.contentLength !== undefined) sets.push(sql`content_length = ${fields.contentLength}`)
  if (fields.tokenCount !== undefined) sets.push(sql`token_count = ${fields.tokenCount}`)
  if (fields.chunkHash !== undefined) sets.push(sql`chunk_hash = ${fields.chunkHash}`)
  if (fields.enabled !== undefined) sets.push(sql`enabled = ${fields.enabled}`)
  if (fields.embedding !== undefined) {
    for (let i = 0; i < fields.embedding.length; i++) {
      if (!Number.isFinite(fields.embedding[i])) {
        throw new Error(`Invalid embedding value at dimension ${i}: ${fields.embedding[i]}`)
      }
    }
    const vectorStr = `[${fields.embedding.join(',')}]`
    sets.push(sql`embedding = ${vectorStr}::vector`)
  }

  await txOrDb.execute(sql`
    UPDATE ${sql.raw(`"${table}"`)}
    SET ${sql.join(sets, sql`, `)}
    WHERE id = ${chunkId}
  `)
}

/** Tag-only search against a per-KB table (no vector similarity) */
export async function searchKBTableTagOnly(
  kbId: string,
  topK: number,
  structuredFilters: StructuredFilter[]
): Promise<SearchResult[]> {
  const table = kbTableName(kbId)
  const tableRef = sql.raw(`"${table}"`)

  const filterConditions = buildRawFilterConditions(structuredFilters)

  const allConditions = [
    sql`e.knowledge_base_id = ${kbId}`,
    sql`e.enabled = TRUE`,
    sql`d.deleted_at IS NULL`,
    sql`d.archived_at IS NULL`,
    sql`d.enabled = TRUE`,
    sql`d.processing_status = 'completed'`,
    sql`d.user_excluded = FALSE`,
    ...filterConditions,
  ]

  const whereClause = sql.join(allConditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      e.id::text,
      e.content,
      e.document_id AS "documentId",
      e.chunk_index AS "chunkIndex",
      e.tag1, e.tag2, e.tag3, e.tag4, e.tag5, e.tag6, e.tag7,
      e.number1::float8, e.number2::float8, e.number3::float8, e.number4::float8, e.number5::float8,
      e.date1, e.date2,
      e.boolean1, e.boolean2, e.boolean3,
      0::float8 AS distance,
      e.knowledge_base_id AS "knowledgeBaseId"
    FROM ${tableRef} e
    INNER JOIN document d ON d.id = e.document_id
    WHERE ${whereClause}
    LIMIT ${topK}
  `)

  return result as unknown as SearchResult[]
}

/** Build SQL conditions from structured filters for raw-SQL per-KB table queries */
function buildRawFilterConditions(filters: StructuredFilter[]): ReturnType<typeof sql>[] {
  const filtersBySlot = new Map<string, StructuredFilter[]>()
  for (const filter of filters) {
    const slot = filter.tagSlot
    if (!filtersBySlot.has(slot)) filtersBySlot.set(slot, [])
    filtersBySlot.get(slot)!.push(filter)
  }

  const conditions: ReturnType<typeof sql>[] = []

  for (const [slot, slotFilters] of filtersBySlot) {
    if (!isTagSlotKey(slot)) continue

    const slotConditions = slotFilters
      .map((f) => buildRawFilterCondition(f))
      .filter((c): c is ReturnType<typeof sql> => c !== null)

    if (slotConditions.length === 0) continue

    conditions.push(
      slotConditions.length === 1
        ? slotConditions[0]
        : sql`(${sql.join(slotConditions, sql` OR `)})`
    )
  }

  return conditions
}

/** Build a single SQL condition for a structured filter using raw column name references */
function buildRawFilterCondition(filter: StructuredFilter): ReturnType<typeof sql> | null {
  const { tagSlot, fieldType, operator, value, valueTo } = filter

  if (!isTagSlotKey(tagSlot)) return null

  // tagSlot is validated against TAG_SLOT_KEYS (all simple alphanumeric) — safe for sql.raw
  // Prefixed with e. to match the table alias used in search queries
  const col = sql.raw(`e.${tagSlot}`)

  if (fieldType === 'text') {
    const stringValue = String(value)
    switch (operator) {
      case 'eq':
        return sql`LOWER(${col}) = LOWER(${stringValue})`
      case 'neq':
        return sql`LOWER(${col}) != LOWER(${stringValue})`
      case 'contains':
        return sql`LOWER(${col}) LIKE LOWER(${`%${stringValue}%`})`
      case 'not_contains':
        return sql`LOWER(${col}) NOT LIKE LOWER(${`%${stringValue}%`})`
      case 'starts_with':
        return sql`LOWER(${col}) LIKE LOWER(${`${stringValue}%`})`
      case 'ends_with':
        return sql`LOWER(${col}) LIKE LOWER(${`%${stringValue}`})`
      default:
        return sql`LOWER(${col}) = LOWER(${stringValue})`
    }
  }

  if (fieldType === 'number') {
    const numValue = typeof value === 'number' ? value : Number.parseFloat(String(value))
    if (Number.isNaN(numValue)) return null
    switch (operator) {
      case 'eq':
        return sql`${col} = ${numValue}`
      case 'neq':
        return sql`${col} != ${numValue}`
      case 'gt':
        return sql`${col} > ${numValue}`
      case 'gte':
        return sql`${col} >= ${numValue}`
      case 'lt':
        return sql`${col} < ${numValue}`
      case 'lte':
        return sql`${col} <= ${numValue}`
      case 'between':
        if (valueTo !== undefined) {
          const numTo = typeof valueTo === 'number' ? valueTo : Number.parseFloat(String(valueTo))
          if (!Number.isNaN(numTo)) return sql`(${col} >= ${numValue} AND ${col} <= ${numTo})`
        }
        return sql`${col} = ${numValue}`
      default:
        return sql`${col} = ${numValue}`
    }
  }

  if (fieldType === 'date') {
    const dateStr = String(value)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
    switch (operator) {
      case 'eq':
        return sql`${col}::date = ${dateStr}::date`
      case 'neq':
        return sql`${col}::date != ${dateStr}::date`
      case 'gt':
        return sql`${col}::date > ${dateStr}::date`
      case 'gte':
        return sql`${col}::date >= ${dateStr}::date`
      case 'lt':
        return sql`${col}::date < ${dateStr}::date`
      case 'lte':
        return sql`${col}::date <= ${dateStr}::date`
      case 'between':
        if (valueTo !== undefined) {
          const dateStrTo = String(valueTo)
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStrTo))
            return sql`(${col}::date >= ${dateStr}::date AND ${col}::date <= ${dateStrTo}::date)`
        }
        return sql`${col}::date = ${dateStr}::date`
      default:
        return sql`${col}::date = ${dateStr}::date`
    }
  }

  if (fieldType === 'boolean') {
    const boolValue = value === true || value === 'true'
    switch (operator) {
      case 'eq':
        return sql`${col} = ${boolValue}`
      case 'neq':
        return sql`${col} != ${boolValue}`
      default:
        return sql`${col} = ${boolValue}`
    }
  }

  return sql`${col} = ${value}`
}
