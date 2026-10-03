import { userTableRows } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { fillAnalyticsBuckets, resolveAnalyticsBucket } from '@/lib/table/analytics/buckets'
import {
  ANALYTICS_MAX_ROW_BYTES,
  ANALYTICS_MAX_ROWS,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AnalyticsValue,
} from '@/lib/table/analytics/schema'
import { columnMatchesRef, getColumnId } from '@/lib/table/column-keys'
import { withReadGuards } from '@/lib/table/planner'
import { validateStoragePredicate } from '@/lib/table/query-builder/validate'
import { predicateToStorage } from '@/lib/table/select-values'
import { buildPredicateClause } from '@/lib/table/sql'
import type { ColumnDefinition, TableDefinition, TablePredicate } from '@/lib/table/types'

function invalid(message: string): never {
  throw new OrchestrationError('validation', message)
}

/** Calendar dates mean midnight UTC; timestamp cells must carry an explicit offset. */
function timestampCell(cell: SQL): SQL {
  return sql`CASE
    WHEN ${cell} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (${cell})::date::timestamp AT TIME ZONE 'UTC'
    WHEN ${cell} ~* '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN (${cell})::timestamptz
    WHEN ${cell} IS NULL THEN NULL
    ELSE ('invalid dashboard timestamp: ' || ${cell})::timestamptz
  END`
}

function fieldExpression(
  table: TableDefinition,
  reference: string
): { expression: SQL; type: string; column?: ColumnDefinition } {
  if (reference === 'createdAt')
    return { expression: sql`${userTableRows.createdAt} AT TIME ZONE 'UTC'`, type: 'date' }
  if (reference === 'updatedAt')
    return { expression: sql`${userTableRows.updatedAt} AT TIME ZONE 'UTC'`, type: 'date' }
  if (reference === 'id') return { expression: sql`${userTableRows.id}`, type: 'string' }
  const column = table.schema.columns.find((item) => columnMatchesRef(item, reference))
  if (!column) invalid(`Unknown table column: ${reference}`)
  if (column.type === 'json' || (column.type === 'select' && column.multiple)) {
    invalid(
      `Column ${reference} is not scalar. Select a string, number, boolean, date, or single select column.`
    )
  }
  const cell = sql`(${userTableRows.data}->>${getColumnId(column)})`
  const expression =
    column.type === 'date' || column.type === 'ttl'
      ? timestampCell(cell)
      : column.type === 'number' || column.type === 'currency'
        ? sql`(${cell})::numeric`
        : column.type === 'boolean'
          ? sql`(${cell})::boolean`
          : cell
  return { expression, type: column.type, column }
}

function instantText(expression: SQL): SQL {
  return sql`to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

function filterExpression(table: TableDefinition, filter: TablePredicate): SQL {
  const predicate = predicateToStorage(filter, table.schema)
  validateStoragePredicate(predicate, table.schema.columns)
  const expression = buildPredicateClause(predicate, 'user_table_rows', table.schema.columns)
  if (!expression) invalid('Filter cannot be empty')
  return expression
}

/** Resolves schema fields, quotes aliases, and binds user values and bucket names. */
export function buildAnalyticsQuery(table: TableDefinition, query: AnalyticsQuery) {
  const timeField = query.timeField ?? 'createdAt'
  const time = fieldExpression(table, timeField)
  if (time.type !== 'date' && time.type !== 'ttl')
    invalid('timeField must be createdAt, updatedAt, or a date column')
  const bucket = resolveAnalyticsBucket(query)
  const conditions = [
    sql`${userTableRows.tableId} = ${table.id}`,
    sql`${userTableRows.workspaceId} = ${table.workspaceId}`,
  ]
  /** Preserve the existing (table_id, created_at, id) index by casting bounds, never created_at. */
  if (timeField === 'createdAt' || timeField === 'updatedAt') {
    const column = timeField === 'createdAt' ? userTableRows.createdAt : userTableRows.updatedAt
    conditions.push(sql`${column} >= (${query.from}::timestamptz AT TIME ZONE 'UTC')`)
    conditions.push(sql`${column} < (${query.to}::timestamptz AT TIME ZONE 'UTC')`)
  } else {
    conditions.push(
      sql`${time.expression} >= ${query.from}::timestamptz`,
      sql`${time.expression} < ${query.to}::timestamptz`
    )
  }
  if (query.filter) {
    conditions.push(filterExpression(table, query.filter))
  }
  const fields = query.aggregate ? (query.groupBy ?? []) : (query.columns ?? [])
  const expressions: SQL[] = []
  const grouping: SQL[] = []
  const columns = [...fields, ...Object.keys(query.aggregate ?? {})]
  const builtinLabels: Record<string, string> = {
    createdAt: 'Created at',
    updatedAt: 'Updated at',
    id: 'ID',
  }
  const columnLabels = Object.fromEntries(columns.map((field) => [field, field]))
  const selectColumns = new Map<string, ColumnDefinition>()
  for (const field of fields) {
    const value = fieldExpression(table, field)
    columnLabels[field] = value.column?.name ?? builtinLabels[field] ?? field
    let expression = value.expression
    if (bucket && field === timeField) expression = sql`date_trunc(${bucket}, ${expression}, 'UTC')`
    if (value.type === 'date' || value.type === 'ttl') expression = instantText(expression)
    if (value.column?.type === 'select') selectColumns.set(field, value.column)
    expressions.push(sql`${expression} AS ${sql.identifier(field)}`)
    /** GROUP BY positions avoid repeating bound JSON keys with different parameter numbers. */
    grouping.push(sql.raw(String(expressions.length)))
  }
  for (const [alias, measure] of Object.entries(query.aggregate ?? {})) {
    if (measure.op === 'percent') {
      const condition = filterExpression(table, measure.filter)
      expressions.push(
        sql`100.0 * count(*) FILTER (WHERE ${condition}) / NULLIF(count(*), 0) AS ${sql.identifier(alias)}`
      )
      continue
    }
    const value = measure.field ? fieldExpression(table, measure.field) : null
    if (
      !['count', 'countDistinct'].includes(measure.op) &&
      value?.type !== 'number' &&
      value?.type !== 'currency'
    ) {
      invalid(`${measure.op} requires a numeric field`)
    }
    const cell = value?.expression ?? sql`*`
    const expression =
      measure.op === 'countDistinct'
        ? sql`count(DISTINCT ${cell})`
        : sql`${sql.raw(measure.op)}(${cell})`
    expressions.push(sql`${expression} AS ${sql.identifier(alias)}`)
  }
  if (expressions.length === 0) invalid('Select columns or aggregates')
  const sort =
    query.sort ??
    (query.aggregate
      ? fields.map((field) => ({ field, direction: 'asc' as const }))
      : [{ field: timeField, direction: 'desc' as const }])
  const order = sort.map(({ field, direction }) => {
    if (query.aggregate && !columns.includes(field))
      invalid(`Unknown result field in sort: ${field}`)
    const expression = columns.includes(field)
      ? sql.identifier(field)
      : fieldExpression(table, field).expression
    return sql`${expression} ${sql.raw(direction)} NULLS LAST`
  })
  if (!query.aggregate) order.push(sql`${userTableRows.id} DESC`)
  const limit = query.limit ?? (query.aggregate ? ANALYTICS_MAX_ROWS : 50)
  const statement = sql`WITH result AS MATERIALIZED (
    SELECT ${sql.join(expressions, sql`, `)} FROM ${userTableRows}
    WHERE ${sql.join(conditions, sql` AND `)}
    ${query.aggregate && grouping.length ? sql`GROUP BY ${sql.join(grouping, sql`, `)}` : sql``}
    ${order.length ? sql`ORDER BY ${sql.join(order, sql`, `)}` : sql``}
    LIMIT ${limit + 1}
  ) SELECT CASE WHEN octet_length(to_jsonb(result)::text) <= ${ANALYTICS_MAX_ROW_BYTES}
      THEN to_jsonb(result) ELSE NULL END AS data FROM result`
  return { statement, columns, columnLabels, bucket, limit, selectColumns }
}

export async function queryTableAnalytics(
  table: TableDefinition,
  query: AnalyticsQuery
): Promise<AnalyticsResult> {
  const compiled = buildAnalyticsQuery(table, query)
  return withReadGuards(
    async (transaction) => {
      const result = await transaction.execute<{ data: Record<string, AnalyticsValue> | null }>(
        compiled.statement
      )
      const truncated = result.length > compiled.limit
      if (truncated && query.aggregate && query.limit === undefined) {
        invalid(
          'More than 500 groups. Narrow the range, increase the bucket, or specify a top-N limit and sort.'
        )
      }
      const rows = result.slice(0, compiled.limit).map(({ data }) => {
        if (!data) invalid('A result row exceeds 8 KB. Select smaller columns or narrow the query.')
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === 'number' && !Number.isFinite(value))
            invalid('Aggregate exceeds the supported numeric range')
          const column = compiled.selectColumns.get(key)
          if (column && typeof value === 'string')
            data[key] = column.options?.find((option) => option.id === value)?.name ?? value
        }
        return data
      })
      return {
        rows: fillAnalyticsBuckets(rows, query, compiled.bucket),
        columns: compiled.columns,
        columnLabels: compiled.columnLabels,
        truncated,
        bucket: compiled.bucket,
      }
    },
    { seqscanOff: true, repeatableRead: true }
  )
}
