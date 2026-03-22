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
  vector,
} from 'drizzle-orm/pg-core'
import type { StructuredFilter } from '@/lib/knowledge/types'
import type { SearchResult } from '@/app/api/knowledge/search/utils'

const logger = createLogger('DynamicKBTables')

const TAG_SLOT_KEYS = [
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

type TagSlotKey = (typeof TAG_SLOT_KEYS)[number]

function isTagSlotKey(key: string): key is TagSlotKey {
  return TAG_SLOT_KEYS.includes(key as TagSlotKey)
}

/** Convert a KB UUID to a valid Postgres table name */
export function kbTableName(kbId: string): string {
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
  const table = kbTableName(kbId)
  logger.info(`Creating per-KB embedding table: ${table} (${dimension}d)`)

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
        embedding vector(${dimension}) NOT NULL,
        embedding_model TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        tag1 TEXT, tag2 TEXT, tag3 TEXT, tag4 TEXT, tag5 TEXT, tag6 TEXT, tag7 TEXT,
        number1 NUMERIC, number2 NUMERIC, number3 NUMERIC, number4 NUMERIC, number5 NUMERIC,
        date1 TIMESTAMPTZ, date2 TIMESTAMPTZ,
        boolean1 BOOLEAN, boolean2 BOOLEAN, boolean3 BOOLEAN,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    id: text('id').primaryKey(),
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

  const filterConditions = buildRawFilterConditions(structuredFilters ?? [])

  const vecParam = sql`${queryVector}::vector`

  const allConditions = [
    sql`knowledge_base_id = ${kbId}`,
    sql`enabled = TRUE`,
    sql`embedding <=> ${vecParam} < ${distanceThreshold}`,
    ...filterConditions,
  ]

  const whereClause = sql.join(allConditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      id::text,
      content,
      document_id AS "documentId",
      chunk_index AS "chunkIndex",
      tag1, tag2, tag3, tag4, tag5, tag6, tag7,
      number1::float8, number2::float8, number3::float8, number4::float8, number5::float8,
      date1, date2,
      boolean1, boolean2, boolean3,
      (embedding <=> ${vecParam})::float8 AS distance,
      knowledge_base_id AS "knowledgeBaseId"
    FROM ${sql.raw(`"${table}"`)}
    WHERE ${whereClause}
    ORDER BY distance
    LIMIT ${topK}
  `)

  return result as any as SearchResult[]
}

/** Tag-only search against a per-KB table (no vector similarity) */
export async function searchKBTableTagOnly(
  kbId: string,
  topK: number,
  structuredFilters: StructuredFilter[]
): Promise<SearchResult[]> {
  const table = kbTableName(kbId)

  const filterConditions = buildRawFilterConditions(structuredFilters)

  const allConditions = [sql`knowledge_base_id = ${kbId}`, sql`enabled = TRUE`, ...filterConditions]

  const whereClause = sql.join(allConditions, sql` AND `)

  const result = await db.execute(sql`
    SELECT
      id::text,
      content,
      document_id AS "documentId",
      chunk_index AS "chunkIndex",
      tag1, tag2, tag3, tag4, tag5, tag6, tag7,
      number1::float8, number2::float8, number3::float8, number4::float8, number5::float8,
      date1, date2,
      boolean1, boolean2, boolean3,
      0::float8 AS distance,
      knowledge_base_id AS "knowledgeBaseId"
    FROM ${sql.raw(`"${table}"`)}
    WHERE ${whereClause}
    LIMIT ${topK}
  `)

  return result as any as SearchResult[]
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
  const col = sql.raw(tagSlot)

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
          if (!Number.isNaN(numTo)) return sql`${col} >= ${numValue} AND ${col} <= ${numTo}`
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
            return sql`${col}::date >= ${dateStr}::date AND ${col}::date <= ${dateStrTo}::date`
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
