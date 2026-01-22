/**
 * LLM tool enrichment utilities for table operations.
 *
 * Provides functions to enrich tool descriptions and parameter schemas
 * with table-specific information so LLMs can construct proper queries.
 */

import type { TableSummary } from '../types'

/**
 * Operations that use filters and need filter-specific enrichment.
 */
export const FILTER_OPERATIONS = new Set([
  'table_query_rows',
  'table_update_rows_by_filter',
  'table_delete_rows_by_filter',
])

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
        obj[col.name] = col.type === 'number' ? 123 : col.type === 'boolean' ? true : 'example'
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
      description: `Maximum rows to return (min: 1, max: 1000, default: 100). For ranking queries: use limit=1 for highest/lowest, limit=2 for second highest, etc.`,
    }
  }

  if (enrichedProperties.data && DATA_OPERATIONS.has(toolId)) {
    const exampleCols = table.columns.slice(0, 2)
    const exampleData = exampleCols.reduce(
      (obj: Record<string, unknown>, col: { name: string; type: string }) => {
        obj[col.name] = col.type === 'number' ? 123 : col.type === 'boolean' ? true : 'value'
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
