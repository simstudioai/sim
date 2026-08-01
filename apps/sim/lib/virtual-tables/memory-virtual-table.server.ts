import { db } from '@sim/db'
import { memory, workspace } from '@sim/db/schema'
import { and, count, desc, eq, inArray, isNull, lt, max, or, sql } from 'drizzle-orm'
import { getMaxPageBytes, TABLE_LIMITS } from '@/lib/table/constants'
import { TableQueryValidationError } from '@/lib/table/errors'
import {
  buildFilterClause,
  buildPredicateClause,
  buildSortClause,
  escapeLikePattern,
} from '@/lib/table/sql'
import type { JsonValue, QueryOptions, TableDefinition } from '@/lib/table/types'
import {
  createMemoryTableDefinition,
  getMemoryTableId,
  isMemoryTableId,
  MEMORY_TABLE_COLUMNS,
  MEMORY_TABLE_SCHEMA,
  mapMemoryRecordToTableRow,
} from '@/lib/virtual-tables/memory-virtual-table'

interface QueryMemoryTableRowsInput extends QueryOptions {
  workspaceId: string
}

const MEMORY_TABLE_ID_PREFIX = getMemoryTableId('')
const MEMORY_ROWS_SQL_NAME = 'memory_rows'
const MEMORY_FIND_MATCH_LIMIT = 1000

function referencesMemoryTranscript(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(referencesMemoryTranscript)
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.field === MEMORY_TABLE_COLUMNS.transcript) return true
  if (Object.hasOwn(record, MEMORY_TABLE_COLUMNS.transcript)) return true
  return Object.values(record).some(referencesMemoryTranscript)
}

function createMemoryRowsQuery() {
  const messageCount = sql<number>`CASE WHEN jsonb_typeof(${memory.data}) = 'array' THEN jsonb_array_length(${memory.data}) ELSE 0 END`
  const createdAtIso = sql<string>`to_char(${memory.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  const updatedAtIso = sql<string>`to_char(${memory.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  const rowData = sql<JsonValue>`jsonb_build_object(
    ${MEMORY_TABLE_COLUMNS.id}::text, ${memory.id},
    ${MEMORY_TABLE_COLUMNS.conversationId}::text, ${memory.key},
    ${MEMORY_TABLE_COLUMNS.transcript}::text, ${memory.data},
    ${MEMORY_TABLE_COLUMNS.messageCount}::text, ${messageCount},
    ${MEMORY_TABLE_COLUMNS.createdAt}::text, ${createdAtIso},
    ${MEMORY_TABLE_COLUMNS.updatedAt}::text, ${updatedAtIso}
  )`
  return db
    .select({
      id: memory.id,
      workspaceId: memory.workspaceId,
      key: memory.key,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      deletedAt: memory.deletedAt,
      transcript: sql<JsonValue>`${memory.data}`.as('transcript'),
      messageCount: messageCount.mapWith(Number).as('message_count'),
      rowBytes: sql<number>`octet_length((${rowData})::text)`.mapWith(Number).as('row_bytes'),
      data: sql<JsonValue>`jsonb_build_object(
        ${MEMORY_TABLE_COLUMNS.id}::text, ${memory.id},
        ${MEMORY_TABLE_COLUMNS.conversationId}::text, ${memory.key},
        ${MEMORY_TABLE_COLUMNS.messageCount}::text, ${messageCount},
        ${MEMORY_TABLE_COLUMNS.createdAt}::text, ${createdAtIso},
        ${MEMORY_TABLE_COLUMNS.updatedAt}::text, ${updatedAtIso}
      )`.as('data'),
    })
    .from(memory)
    .as(MEMORY_ROWS_SQL_NAME)
}

/**
 * Builds the virtual Memory table from workspace identity and active-memory
 * aggregates without materializing any transcript JSON in the app process.
 */
export async function getMemoryTableDefinition(
  workspaceId: string
): Promise<TableDefinition | null> {
  const workspacePromise = db
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  const summaryPromise = db
    .select({
      rowCount: count(),
      lastMemoryUpdatedAt: max(memory.updatedAt),
    })
    .from(memory)
    .where(and(eq(memory.workspaceId, workspaceId), isNull(memory.deletedAt)))

  const [workspaceRows, summaryRows] = await Promise.all([workspacePromise, summaryPromise])
  const workspaceRecord = workspaceRows[0]
  if (!workspaceRecord) return null
  const summary = summaryRows[0]

  return createMemoryTableDefinition({
    workspace: workspaceRecord,
    rowCount: Number(summary.rowCount),
    lastMemoryUpdatedAt: summary.lastMemoryUpdatedAt,
  })
}

export async function getMemoryTableById(tableId: string): Promise<TableDefinition | null> {
  if (!isMemoryTableId(tableId)) return null
  const workspaceId = tableId.slice(MEMORY_TABLE_ID_PREFIX.length)
  if (!workspaceId) return null
  return getMemoryTableDefinition(workspaceId)
}

/**
 * The keyset uses `updatedAt` because Memory has no immutable ordering column.
 * A conversation updated during a multi-page read can move ahead of the cursor
 * and be omitted until the grid is refreshed; each individual page remains
 * deterministic through the `id` tie-breaker.
 */
export async function queryMemoryTableRows({
  workspaceId,
  limit = TABLE_LIMITS.DEFAULT_QUERY_LIMIT,
  offset = 0,
  after,
  includeTotal = true,
  filter,
  predicate,
  sort,
}: QueryMemoryTableRowsInput) {
  if (after && offset > 0) {
    throw new TableQueryValidationError(
      'Memory table pagination cannot combine a cursor and offset'
    )
  }

  const afterUpdatedAt = after ? new Date(after.orderKey) : null
  if (afterUpdatedAt && Number.isNaN(afterUpdatedAt.getTime())) {
    throw new TableQueryValidationError('Invalid memory table cursor')
  }

  if (
    referencesMemoryTranscript(filter) ||
    referencesMemoryTranscript(predicate) ||
    referencesMemoryTranscript(sort)
  ) {
    throw new TableQueryValidationError(
      'Transcript filtering and sorting are not supported for this table'
    )
  }

  const memoryRows = createMemoryRowsQuery()
  const filterClause = predicate
    ? buildPredicateClause(predicate, MEMORY_ROWS_SQL_NAME, MEMORY_TABLE_SCHEMA.columns)
    : filter
      ? buildFilterClause(filter, MEMORY_ROWS_SQL_NAME, MEMORY_TABLE_SCHEMA.columns)
      : undefined
  const baseWhere = and(
    eq(memoryRows.workspaceId, workspaceId),
    isNull(memoryRows.deletedAt),
    filterClause
  )
  const sortClause = sort
    ? buildSortClause(sort, MEMORY_ROWS_SQL_NAME, MEMORY_TABLE_SCHEMA.columns)
    : undefined
  const orderBy = sortClause
    ? [sortClause, desc(memoryRows.id)]
    : [desc(memoryRows.updatedAt), desc(memoryRows.id)]
  const pageWhere =
    after && afterUpdatedAt
      ? and(
          baseWhere,
          or(
            lt(memoryRows.updatedAt, afterUpdatedAt),
            and(eq(memoryRows.updatedAt, afterUpdatedAt), lt(memoryRows.id, after.id))
          )
        )
      : baseWhere

  const candidateQuery = db
    .select({
      id: memoryRows.id,
      key: memoryRows.key,
      createdAt: memoryRows.createdAt,
      updatedAt: memoryRows.updatedAt,
      messageCount: memoryRows.messageCount,
      rowBytes: memoryRows.rowBytes,
    })
    .from(memoryRows)
    .where(pageWhere)
    .orderBy(...orderBy)
    .limit(limit)
  const candidatePromise = !after && offset > 0 ? candidateQuery.offset(offset) : candidateQuery

  const totalPromise = includeTotal
    ? db.select({ value: count() }).from(memoryRows).where(baseWhere)
    : Promise.resolve(null)
  const [candidates, totalRows] = await Promise.all([candidatePromise, totalPromise])
  const pageByteBudget = getMaxPageBytes() ?? TABLE_LIMITS.MAX_QUERY_RESULT_BYTES
  const selectedCandidates: typeof candidates = []
  let selectedBytes = 0
  let hasMore = false

  for (const candidate of candidates) {
    const rowBytes = Number(candidate.rowBytes)
    if (!Number.isFinite(rowBytes) || rowBytes < 0) {
      throw new TableQueryValidationError('Memory table returned an invalid row size')
    }
    if (selectedCandidates.length === 0 && rowBytes > pageByteBudget) {
      throw new TableQueryValidationError(
        `Memory transcript exceeds the ${Math.floor(pageByteBudget / (1024 * 1024))}MB query response limit`,
        'TABLE_QUERY_RESULT_TOO_LARGE'
      )
    }
    if (selectedCandidates.length > 0 && selectedBytes + rowBytes > pageByteBudget) {
      hasMore = true
      break
    }
    selectedCandidates.push(candidate)
    selectedBytes += rowBytes
  }

  const selectedIds = selectedCandidates.map((candidate) => candidate.id)
  const transcripts =
    selectedIds.length > 0
      ? await db
          .select({ id: memory.id, data: sql<JsonValue>`${memory.data}` })
          .from(memory)
          .where(
            and(
              eq(memory.workspaceId, workspaceId),
              isNull(memory.deletedAt),
              inArray(memory.id, selectedIds)
            )
          )
          .limit(selectedIds.length)
      : []
  const transcriptById = new Map(transcripts.map((record) => [record.id, record.data]))
  const rows = selectedCandidates.flatMap((candidate, index) => {
    const transcript = transcriptById.get(candidate.id)
    if (transcript === undefined) return []
    return [
      mapMemoryRecordToTableRow(
        {
          id: candidate.id,
          key: candidate.key,
          data: transcript,
          messageCount: candidate.messageCount,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        },
        offset + index
      ),
    ]
  })

  return {
    rows,
    totalCount: totalRows ? Number(totalRows[0].value) : null,
    keysetValid: !sort,
    hasMore,
  }
}
/** Searches Memory cells in PostgreSQL while preserving the active view's row ordinals. */
export async function findMemoryTableRowMatches({
  workspaceId,
  q,
  filter,
  sort,
}: {
  workspaceId: string
  q: string
  filter?: QueryOptions['filter']
  sort?: QueryOptions['sort']
}): Promise<{
  matches: Array<{ ordinal: number; rowId: string; column: string }>
  truncated: boolean
}> {
  if (referencesMemoryTranscript(filter) || referencesMemoryTranscript(sort)) {
    throw new TableQueryValidationError(
      'Transcript filtering and sorting are not supported for this table'
    )
  }

  const memoryRows = createMemoryRowsQuery()
  const filterClause = filter
    ? buildFilterClause(filter, MEMORY_ROWS_SQL_NAME, MEMORY_TABLE_SCHEMA.columns)
    : undefined
  const whereClause = and(
    eq(memoryRows.workspaceId, workspaceId),
    isNull(memoryRows.deletedAt),
    filterClause
  )
  const sortClause = sort
    ? buildSortClause(sort, MEMORY_ROWS_SQL_NAME, MEMORY_TABLE_SCHEMA.columns)
    : undefined
  const primaryOrder = sortClause ?? desc(memoryRows.updatedAt)
  const tieBreaker = desc(memoryRows.id)
  const pattern = `%${escapeLikePattern(q)}%`
  const result = await db.execute<{
    ordinal: string | number
    id: string
    column_name: string
  }>(sql`
    WITH ordered AS (
      SELECT
        ${memoryRows.id} AS id,
        ${memoryRows.data} AS data,
        ${memoryRows.transcript} AS transcript,
        row_number() OVER (ORDER BY ${primaryOrder}, ${tieBreaker}) - 1 AS ordinal
      FROM ${memoryRows}
      WHERE ${whereClause}
    )
    SELECT ordered.ordinal, ordered.id, cells.key AS column_name
    FROM ordered
    CROSS JOIN LATERAL jsonb_each_text(
      ordered.data || jsonb_build_object(
        ${MEMORY_TABLE_COLUMNS.transcript}::text,
        ordered.transcript
      )
    ) cells
    WHERE cells.value ILIKE ${pattern}
    ORDER BY ordered.ordinal
    LIMIT ${MEMORY_FIND_MATCH_LIMIT + 1}
  `)

  const rows = Array.from(result)
  const truncated = rows.length > MEMORY_FIND_MATCH_LIMIT
  return {
    matches: rows.slice(0, MEMORY_FIND_MATCH_LIMIT).map((row) => ({
      ordinal: Number(row.ordinal),
      rowId: row.id,
      column: row.column_name,
    })),
    truncated,
  }
}
