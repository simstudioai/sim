/**
 * Date tag filters in real PostgreSQL: each range selects exactly the rows the calendar-day
 * comparison does, and a selective one is served by the slot index.
 */

import { document, embedding } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTagFilterCondition } from '@/lib/knowledge/documents/tag-filter'
import { getStructuredTagFilters } from '@/lib/knowledge/search/tag-filters'

const DAY = '2026-03-15'
const NEXT_DAY = '2026-03-16'

/** Every instant a day boundary can misplace, plus an untagged row. */
const TAG_VALUES = [
  '2026-03-14 23:59:59.999999',
  '2026-03-15 00:00:00',
  '2026-03-15 12:00:00',
  '2026-03-15 23:59:59.999999',
  '2026-03-16 00:00:00',
  '2026-03-16 23:59:59.999999',
  '2026-03-17 00:00:00',
  null,
]

/** Session time zones on both sides of UTC, far enough to move a date across midnight. */
const TIME_ZONES = ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']

interface DateFilter {
  operator: string
  value: string
  valueTo?: string
}

const FILTERS: DateFilter[] = [
  { operator: 'eq', value: DAY },
  { operator: 'neq', value: DAY },
  { operator: 'gt', value: DAY },
  { operator: 'gte', value: DAY },
  { operator: 'lt', value: DAY },
  { operator: 'lte', value: DAY },
  { operator: 'between', value: DAY, valueTo: DAY },
  { operator: 'between', value: DAY, valueTo: NEXT_DAY },
]

/** The calendar-day comparison date filters have always meant, written as a `::date` cast. */
function calendarDayCondition(column: SQL, { operator, value, valueTo }: DateFilter): SQL {
  switch (operator) {
    case 'neq':
      return sql`${column}::date != ${value}::date`
    case 'gt':
      return sql`${column}::date > ${value}::date`
    case 'gte':
      return sql`${column}::date >= ${value}::date`
    case 'lt':
      return sql`${column}::date < ${value}::date`
    case 'lte':
      return sql`${column}::date <= ${value}::date`
    case 'between':
      return sql`${column}::date >= ${value}::date AND ${column}::date <= ${valueTo}::date`
    default:
      return sql`${column}::date = ${value}::date`
  }
}

function searchCondition(filter: DateFilter): SQL {
  const [condition] = getStructuredTagFilters(
    [{ tagSlot: 'date1', fieldType: 'date', ...filter }],
    embedding
  )
  return condition
}

function documentCondition(filter: DateFilter): SQL {
  const condition = buildTagFilterCondition({ tagSlot: 'date1', fieldType: 'date', ...filter })
  if (!condition) throw new Error(`No document predicate for ${filter.operator}`)
  return condition
}

interface PlanNode {
  'Index Name'?: string
  Plans?: PlanNode[]
}

function indexNames(node: PlanNode): string[] {
  return [
    ...(node['Index Name'] ? [node['Index Name']] : []),
    ...(node.Plans ?? []).flatMap(indexNames),
  ]
}

describe('date tag filters in PostgreSQL', () => {
  const schemaName = `date_tag_filters_${generateId().replaceAll('-', '')}`
  const connection = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({
      max: 1,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName },
      onnotice: () => {},
    })
  )
  const db = drizzle(connection)

  /** Copies the shipped slot index definition, so the plan proves the migration's index. */
  async function copyIndex(indexName: string) {
    const [{ indexdef }] = await connection<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${indexName}`
    await connection.unsafe(indexdef.replace(' ON public.', ' ON '))
  }

  async function matchingIds(table: typeof document | typeof embedding, condition: SQL) {
    const rows = await db.select({ id: table.id }).from(table).where(condition)
    return rows.map((row) => row.id).sort()
  }

  async function plannedIndexes(table: typeof document | typeof embedding, condition: SQL) {
    const query = db.select({ id: table.id }).from(table).where(condition).toSQL()
    const [row] = await connection.unsafe<{ 'QUERY PLAN': [{ Plan: PlanNode }] }[]>(
      `EXPLAIN (FORMAT JSON) ${query.sql}`,
      query.params as never[]
    )
    return indexNames(row['QUERY PLAN'][0].Plan)
  }

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    await connection`CREATE TABLE document (LIKE public.document INCLUDING DEFAULTS)`
    await connection`CREATE TABLE embedding (LIKE public.embedding INCLUDING DEFAULTS INCLUDING GENERATED)`
  })

  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
    }
  })

  describe('matching rows', () => {
    beforeAll(async () => {
      for (const [index, date1] of TAG_VALUES.entries()) {
        const id = `row-${index}`
        await connection`
          INSERT INTO document (id, knowledge_base_id, filename, file_url, mime_type, file_size, date1)
          VALUES (${id}, 'kb', 'file.txt', 'file-url', 'text/plain', 1, ${date1}::timestamp)`
        await connection`
          INSERT INTO embedding (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content,
            content_length, token_count, start_offset, end_offset, date1)
          VALUES (${id}, 'kb', ${id}, 0, 'hash', 'chunk', 5, 1, 0, 5, ${date1}::timestamp)`
      }
    })

    it.each(TIME_ZONES)(
      'selects the rows of the calendar-day comparison for every operator under %s',
      async (timeZone) => {
        await connection.unsafe(`SET TIME ZONE '${timeZone}'`)
        try {
          for (const filter of FILTERS) {
            const expectedDocuments = await matchingIds(
              document,
              calendarDayCondition(sql`${document.date1}`, filter)
            )
            const expectedChunks = await matchingIds(
              embedding,
              calendarDayCondition(sql`${embedding.date1}`, filter)
            )
            expect(await matchingIds(document, documentCondition(filter)), filter.operator).toEqual(
              expectedDocuments
            )
            expect(await matchingIds(embedding, searchCondition(filter)), filter.operator).toEqual(
              expectedChunks
            )
          }
        } finally {
          await connection`SET TIME ZONE 'UTC'`
        }
      }
    )

    it('narrows search to the day for an unknown operator or an unbounded between', async () => {
      const day = await matchingIds(
        embedding,
        calendarDayCondition(sql`${embedding.date1}`, { operator: 'eq', value: DAY })
      )
      expect(day).toEqual(['row-1', 'row-2', 'row-3'])
      expect(await matchingIds(embedding, searchCondition({ operator: 'on', value: DAY }))).toEqual(
        day
      )
      expect(
        await matchingIds(embedding, searchCondition({ operator: 'between', value: DAY }))
      ).toEqual(day)
    })
  })

  describe('query plans', () => {
    beforeAll(async () => {
      await connection`TRUNCATE document, embedding`
      await connection`
        INSERT INTO document (id, knowledge_base_id, filename, file_url, mime_type, file_size, date1)
        SELECT 'doc-' || n, 'kb', 'file.txt', 'file-url', 'text/plain', 1,
          '2020-01-01'::timestamp + n * interval '1 hour'
        FROM generate_series(1, 50000) AS n`
      await connection`
        INSERT INTO embedding (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content,
          content_length, token_count, start_offset, end_offset, date1)
        SELECT 'chunk-' || n, 'kb', 'doc-' || n, 0, 'hash', 'chunk', 5, 1, 0, 5,
          '2020-01-01'::timestamp + n * interval '1 hour'
        FROM generate_series(1, 50000) AS n`
      await copyIndex('doc_date1_idx')
      await copyIndex('emb_date1_idx')
      await connection`ANALYZE document`
      await connection`ANALYZE embedding`
    })

    it.each([
      { operator: 'eq', value: '2022-06-01' },
      { operator: 'between', value: '2022-06-01', valueTo: '2022-06-03' },
      { operator: 'gte', value: '2025-09-01' },
      { operator: 'lt', value: '2020-01-03' },
    ])('serves a selective $operator filter from the date slot index', async (filter) => {
      expect(await plannedIndexes(document, documentCondition(filter))).toContain('doc_date1_idx')
      expect(await plannedIndexes(embedding, searchCondition(filter))).toContain('emb_date1_idx')
    })
  })
})
