import { columnTypeById, MULTI_SELECT_OPS, SINGLE_SELECT_OPS } from '@/lib/table/column-types'
import type { TableSummary } from '@/lib/table/types'

/**
 * Operations that take a v1 MongoDB-style filter (`{"col": {"$eq": v}}`) and
 * need filter-specific enrichment.
 *
 * The two bulk operations stay here even though the v2 Table block also exposes
 * them: `resolveBulkFilter` in the rows route accepts either grammar, and
 * enrichment is keyed on tool id alone — it cannot see which block invoked it —
 * so one grammar has to be taught, and `$eq` is the one that works for both.
 * Only the query tool has a v2-exclusive id, which is why it is the only one
 * that gets a predicate-grammar branch.
 */
export const FILTER_OPERATIONS = new Set([
  'table_query_rows',
  'table_update_rows_by_filter',
  'table_delete_rows_by_filter',
])

/**
 * The v2 row query. Its filter is a typed predicate
 * (`{"field":"wins","op":"gte","value":10}`) with `all`/`any` groups, it orders
 * via `order` rather than `sort`, and it pages by opaque `cursor` rather than
 * offset — so none of the v1 enrichment above applies to it.
 */
const TABLE_QUERY_ROWS_V2 = 'table_query_rows_v2'

/** The operators a select column actually accepts, read from the validator's own sets. */
function selectOperatorList(multiple: boolean | undefined): string {
  return Array.from(multiple ? MULTI_SELECT_OPS : SINGLE_SELECT_OPS).join(', ')
}

/**
 * Renders one column line for the v2 description.
 *
 * A select column accepts only a subset of the operators — `eq`/`ne`/`in`/`nin`
 * when single, `contains`/`ncontains` when multi — and the query layer THROWS on
 * anything else (`buildFilterConditions` in `lib/table/sql.ts`). Naming the
 * subset inline is what stops the model from reaching for `ilike` on a select
 * column and turning a valid question into a validation error.
 */
function v2ColumnLine(column: TableSummary['columns'][number]): string {
  if (column.type !== 'select') return `  - ${column.name} (${column.type})`
  const kind = column.multiple ? 'multi-select' : 'single-select'
  return `  - ${column.name} (${kind}; only ${selectOperatorList(column.multiple)})`
}

/** Whether any column restricts its operators, i.e. whether the note is worth emitting. */
function hasSelectColumn(table: TableSummary): boolean {
  return table.columns.some((column) => column.type === 'select')
}

/**
 * A one-line summary of the per-column restrictions, for the `filter` parameter
 * description. The parameter schema is what a model reads when it is deciding
 * the SHAPE of the filter, so the restriction has to appear there too and not
 * only in the tool description.
 */
function selectRestrictionNote(table: TableSummary): string {
  const single = table.columns.filter((c) => c.type === 'select' && !c.multiple).map((c) => c.name)
  const multi = table.columns.filter((c) => c.type === 'select' && c.multiple).map((c) => c.name)
  const parts: string[] = []
  if (single.length > 0) {
    parts.push(`${single.join(', ')} accept only ${selectOperatorList(false)}`)
  }
  if (multi.length > 0) {
    parts.push(
      `${multi.join(', ')} hold a list and accept only ${selectOperatorList(true)} (match by option name)`
    )
  }
  return ` Restricted columns - a predicate using any other operator on one is rejected outright: ${parts.join('; ')}.`
}

/**
 * Builds a predicate example from real columns, preferring a numeric `gte` over
 * a string `eq` because ranking and threshold questions are what the grammar
 * most often gets wrong. Returns an empty string when the table has no column
 * to name, so the model is never shown a placeholder it might copy literally.
 */
function v2PredicateExample(table: TableSummary): string {
  const stringCol = table.columns.find((c) => c.type === 'string')
  const numberCol = table.columns.find((c) => c.type === 'number')

  if (numberCol && stringCol) {
    return `

Example filter (one condition): {"field":"${numberCol.name}","op":"gte","value":10}
Example filter (AND group): {"all":[{"field":"${numberCol.name}","op":"gte","value":10},{"field":"${stringCol.name}","op":"eq","value":"active"}]}`
  }
  if (numberCol) {
    return `

Example filter: {"field":"${numberCol.name}","op":"gte","value":10}`
  }
  if (stringCol) {
    return `

Example filter: {"field":"${stringCol.name}","op":"eq","value":"active"}`
  }
  return ''
}

/**
 * Operations that need column info for data construction.
 */
export const DATA_OPERATIONS = new Set([
  'table_insert_row',
  'table_batch_insert_rows',
  'table_upsert_row',
  'table_update_row',
])

/**
 * Enriches a table tool description with table information based on the operation type.
 */
export function enrichTableToolDescription(
  originalDescription: string,
  table: TableSummary,
  toolId: string
): string {
  if (!table.columns || table.columns.length === 0) {
    return originalDescription
  }

  const columnList = table.columns.map((col) => `  - ${col.name} (${col.type})`).join('\n')

  if (toolId === TABLE_QUERY_ROWS_V2) {
    const v2ColumnList = table.columns.map(v2ColumnLine).join('\n')
    /*
     * An unknown field is rejected outright (`Unknown filter column`), so the
     * wildcard example names a real text column or is dropped entirely rather
     * than inviting the model to copy a placeholder.
     */
    const textCol = table.columns.find((c) => c.type === 'string')
    const wildcardRule = textCol
      ? `5. like/ilike use * as the wildcard, e.g. {"field":"${textCol.name}","op":"ilike","value":"*jo*"}`
      : '5. like/ilike use * as the wildcard, matching anywhere in a text value'
    const numberCol = table.columns.find((c) => c.type === 'number')
    const orderExample = numberCol
      ? `
Example order: [{"field":"${numberCol.name}","direction":"desc"}] for highest first, "asc" for lowest first`
      : ''

    return `${originalDescription}

INSTRUCTIONS:
1. Build the filter yourself from the user's question - do NOT ask for confirmation
2. A single condition is a plain object: {"field":"<column>","op":"<operator>","value":<value>}
3. For multiple conditions wrap them in {"all":[...]} for AND or {"any":[...]} for OR; groups nest
4. Operators: eq, ne, gt, gte, lt, lte, in, nin, like, ilike, nlike, nilike, contains, ncontains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty
${wildcardRule}
6. Any column listed below with a restricted operator set accepts ONLY those operators - the query is rejected outright otherwise. A multi-select cell holds a list, so match it by option name with contains, never ilike
7. For substring matching on a text column use ilike with *x*
8. For ranking queries (highest, lowest, Nth, top N) set order and a small limit, e.g. limit 1 for the highest, 2 for the second highest
9. Omit limit to return every matching row; the query fails if the result exceeds 5MB, so narrow with a filter instead of guessing a limit
10. With a limit, a page can end early at the byte budget - a non-null nextCursor means more rows remain, so pass it back as cursor and loop until it is null. Never infer completion from page size
11. Omit the filter only when the user genuinely wants every row

Table "${table.name}" columns:
${v2ColumnList}
${v2PredicateExample(table)}${orderExample}`
  }

  if (FILTER_OPERATIONS.has(toolId)) {
    const stringCols = table.columns.filter((c) => c.type === 'string')
    const numberCols = table.columns.filter((c) => c.type === 'number')

    let filterExample = ''
    if (stringCols.length > 0 && numberCols.length > 0) {
      filterExample = `

Example filter: {"${stringCols[0].name}": {"$eq": "value"}, "${numberCols[0].name}": {"$lt": 50}}`
    } else if (stringCols.length > 0) {
      filterExample = `

Example filter: {"${stringCols[0].name}": {"$eq": "value"}}`
    }

    let sortExample = ''
    if (toolId === 'table_query_rows' && numberCols.length > 0) {
      sortExample = `
Example sort: {"${numberCols[0].name}": "desc"} for highest first, {"${numberCols[0].name}": "asc"} for lowest first`
    }

    const queryInstructions =
      toolId === 'table_query_rows'
        ? `
INSTRUCTIONS:
1. ALWAYS include a filter based on the user's question - queries without filters will fail
2. Construct the filter yourself from the user's question - do NOT ask for confirmation
3. Use exact match ($eq) by default unless the user specifies otherwise
4. For ranking queries (highest, lowest, Nth, top N):
   - ALWAYS use sort with the relevant column (e.g., {"salary": "desc"} for highest salary)
   - Use limit to get only the needed rows (e.g., limit=1 for highest, limit=2 for second highest)
   - For "second highest X", use sort: {"X": "desc"} with limit: 2, then take the second result
5. Only use limit=1000 when you need ALL matching rows`
        : `
INSTRUCTIONS:
1. ALWAYS include a filter based on the user's question - queries without filters will fail
2. Construct the filter yourself from the user's question - do NOT ask for confirmation
3. Use exact match ($eq) by default unless the user specifies otherwise`

    return `${originalDescription}
${queryInstructions}

Table "${table.name}" columns:
${columnList}
${filterExample}${sortExample}`
  }

  if (DATA_OPERATIONS.has(toolId)) {
    const exampleCols = table.columns.slice(0, 3)
    const dataExample = exampleCols.reduce(
      (obj, col) => {
        obj[col.name] = columnTypeById(col.type).sampleValue
        return obj
      },
      {} as Record<string, unknown>
    )

    if (toolId === 'table_update_row') {
      return `${originalDescription}

Table "${table.name}" available columns:
${columnList}

For updates, only include the fields you want to change. Example: {"${exampleCols[0]?.name || 'field'}": "new_value"}`
    }

    return `${originalDescription}

Table "${table.name}" available columns:
${columnList}

Pass the "data" parameter with an object like: ${JSON.stringify(dataExample)}`
  }

  return `${originalDescription}

Table "${table.name}" columns:
${columnList}`
}

/**
 * Enriches LLM tool parameters with table-specific information.
 */
export function enrichTableToolParameters(
  llmSchema: { properties?: Record<string, any>; required?: string[] },
  table: TableSummary,
  toolId: string
): { properties: Record<string, any>; required: string[] } {
  if (!table.columns || table.columns.length === 0) {
    return {
      properties: llmSchema.properties || {},
      required: llmSchema.required || [],
    }
  }

  const columnNames = table.columns.map((c) => c.name).join(', ')
  const enrichedProperties = { ...llmSchema.properties }
  const enrichedRequired = llmSchema.required ? [...llmSchema.required] : []

  if (toolId === TABLE_QUERY_ROWS_V2) {
    if (enrichedProperties.filter) {
      enrichedProperties.filter = {
        ...enrichedProperties.filter,
        description: `Predicate built from the user's question using columns: ${columnNames}. One condition is {"field":"<column>","op":"<operator>","value":<value>}; combine with {"all":[...]} for AND or {"any":[...]} for OR. Operators: eq, ne, gt, gte, lt, lte, in, nin, like, ilike, nlike, nilike, contains, ncontains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty.${hasSelectColumn(table) ? selectRestrictionNote(table) : ''} Omit only to match every row.`,
      }
    }

    if (enrichedProperties.order) {
      enrichedProperties.order = {
        ...enrichedProperties.order,
        description: `Sort spec as [{"field":"<column>","direction":"asc"|"desc"}] over columns: ${columnNames}. REQUIRED for ranking queries (highest, lowest, Nth).`,
      }
    }

    if (enrichedProperties.columns) {
      enrichedProperties.columns = {
        ...enrichedProperties.columns,
        description: `Column names to include in each row. Available: ${columnNames}. Omit to return all columns.`,
      }
    }

    if (enrichedProperties.limit) {
      enrichedProperties.limit = {
        ...enrichedProperties.limit,
        description: `Maximum rows per page (min: 1). Omit to return every matching row; the query fails if the result exceeds 5MB, so narrow with a filter rather than guessing. For ranking queries: 1 for the highest/lowest, 2 for the second highest.`,
      }
    }

    if (enrichedProperties.cursor) {
      enrichedProperties.cursor = {
        ...enrichedProperties.cursor,
        description: `Opaque cursor from a prior page's nextCursor. Omit for the first page. A non-null nextCursor means more rows remain even if the page came back short - loop until it is null.`,
      }
    }

    /*
     * Deliberately NOT pushed into `required`: unlike v1, a v2 query with no
     * filter is valid and returns every row. Forcing it would make the model
     * invent a filter for "list everything".
     */
    return { properties: enrichedProperties, required: enrichedRequired }
  }

  if (enrichedProperties.filter && FILTER_OPERATIONS.has(toolId)) {
    enrichedProperties.filter = {
      ...enrichedProperties.filter,
      description: `REQUIRED - query will fail without a filter. Construct filter from user's question using columns: ${columnNames}. Syntax: {"column": {"$eq": "value"}}`,
    }
  }

  if (FILTER_OPERATIONS.has(toolId) && !enrichedRequired.includes('filter')) {
    enrichedRequired.push('filter')
  }

  if (enrichedProperties.sort && toolId === 'table_query_rows') {
    enrichedProperties.sort = {
      ...enrichedProperties.sort,
      description: `Sort order as {field: "asc"|"desc"}. REQUIRED for ranking queries (highest, lowest, Nth). Example: {"salary": "desc"} for highest salary first.`,
    }
  }

  if (enrichedProperties.limit && toolId === 'table_query_rows') {
    enrichedProperties.limit = {
      ...enrichedProperties.limit,
      description: `Maximum rows to return (min: 1). Omit to return every matching row; the query fails if the result exceeds 5MB. For ranking queries: use limit=1 for highest/lowest, limit=2 for second highest, etc.`,
    }
  }

  if (enrichedProperties.data && DATA_OPERATIONS.has(toolId)) {
    const exampleCols = table.columns.slice(0, 2)
    const exampleData = exampleCols.reduce(
      (obj: Record<string, unknown>, col: { name: string; type: string }) => {
        obj[col.name] = columnTypeById(col.type).sampleValue
        return obj
      },
      {} as Record<string, unknown>
    )

    if (toolId === 'table_update_row') {
      enrichedProperties.data = {
        ...enrichedProperties.data,
        description: `Object containing fields to update. Only include fields you want to change. Available columns: ${columnNames}`,
      }
    } else {
      enrichedProperties.data = {
        ...enrichedProperties.data,
        description: `REQUIRED object containing row values. Use columns: ${columnNames}. Example value: ${JSON.stringify(exampleData)}`,
      }
    }
  }

  if (enrichedProperties.rows && toolId === 'table_batch_insert_rows') {
    enrichedProperties.rows = {
      ...enrichedProperties.rows,
      description: `REQUIRED. Array of row objects. Each object uses columns: ${columnNames}`,
    }
  }

  return {
    properties: enrichedProperties,
    required: enrichedRequired,
  }
}
