/**
 * LLM tool enrichment utilities for table operations.
 *
 * Provides functions to enrich tool descriptions and parameter schemas
 * with table-specific information so LLMs can construct proper queries.
 */

import { createLogger } from '@sim/logger'
import type { TableSummary } from '../types'

const logger = createLogger('TableLLMEnrichment')

export interface TableEnrichmentContext {
  workspaceId: string
  workflowId: string
  executeTool: (toolId: string, params: Record<string, any>) => Promise<any>
}

export interface TableEnrichmentResult {
  description: string
  parameters: {
    properties: Record<string, any>
    required: string[]
  }
}

/**
 * Enriches a table tool for LLM consumption by fetching its schema
 * and injecting column information into the description and parameters.
 *
 * @param toolId - The table tool ID (e.g., 'table_query_rows')
 * @param originalDescription - The tool's original description
 * @param llmSchema - The original LLM schema
 * @param userProvidedParams - Parameters provided by the user (must include tableId)
 * @param context - Execution context with workspaceId, workflowId, and executeTool
 * @returns Enriched description and parameters, or null if enrichment not applicable
 */
export async function enrichTableToolForLLM(
  toolId: string,
  originalDescription: string,
  llmSchema: { properties?: Record<string, any>; required?: string[] },
  userProvidedParams: Record<string, any>,
  context: TableEnrichmentContext
): Promise<TableEnrichmentResult | null> {
  const { tableId } = userProvidedParams

  // Need a tableId to fetch schema
  if (!tableId) {
    return null
  }

  try {
    logger.info(`Fetching schema for table ${tableId}`)

    const schemaResult = await context.executeTool('table_get_schema', {
      tableId,
      _context: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
      },
    })

    if (!schemaResult.success || !schemaResult.output) {
      logger.warn(`Failed to fetch table schema: ${schemaResult.error}`)
      return null
    }

    const tableSchema: TableSummary = {
      name: schemaResult.output.name,
      columns: schemaResult.output.columns || [],
    }

    // Apply enrichment using the existing utility functions
    const enrichedDescription = enrichTableToolDescription(originalDescription, tableSchema, toolId)

    const enrichedParams = enrichTableToolParameters(llmSchema, tableSchema, toolId)

    logger.info(`Enriched ${toolId} with ${tableSchema.columns.length} columns`)

    return {
      description: enrichedDescription,
      parameters: {
        properties: enrichedParams.properties,
        required:
          enrichedParams.required.length > 0 ? enrichedParams.required : llmSchema.required || [],
      },
    }
  } catch (error) {
    logger.warn(`Error fetching table schema:`, error)
    return null
  }
}

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
 *
 * @param originalDescription - The original tool description
 * @param table - The table summary with name and columns
 * @param toolId - The tool identifier to determine operation type
 * @returns Enriched description with table-specific instructions
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

  // Filter-based operations: emphasize filter usage
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

    // Add sort example for query operations with numeric columns
    let sortExample = ''
    if (toolId === 'table_query_rows' && numberCols.length > 0) {
      sortExample = `
Example sort: {"${numberCols[0].name}": "desc"} for highest first, {"${numberCols[0].name}": "asc"} for lowest first`
    }

    // Query-specific instructions with sort/limit guidance
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

  // Data operations: show columns for data construction
  if (DATA_OPERATIONS.has(toolId)) {
    const exampleCols = table.columns.slice(0, 3)
    const dataExample = exampleCols.reduce(
      (obj, col) => {
        obj[col.name] = col.type === 'number' ? 123 : col.type === 'boolean' ? true : 'example'
        return obj
      },
      {} as Record<string, unknown>
    )

    return `${originalDescription}

Table "${table.name}" available columns:
${columnList}

Pass the "data" parameter with an object like: ${JSON.stringify(dataExample)}`
  }

  // Default: just show columns
  return `${originalDescription}

Table "${table.name}" columns:
${columnList}`
}

/**
 * Enriches LLM tool parameters with table-specific information.
 *
 * @param llmSchema - The original LLM schema with properties and required fields
 * @param table - The table summary with name and columns
 * @param toolId - The tool identifier to determine operation type
 * @returns Enriched schema with updated property descriptions and required fields
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

  // Enrich filter parameter for filter-based operations
  if (enrichedProperties.filter && FILTER_OPERATIONS.has(toolId)) {
    enrichedProperties.filter = {
      ...enrichedProperties.filter,
      description: `REQUIRED - query will fail without a filter. Construct filter from user's question using columns: ${columnNames}. Syntax: {"column": {"$eq": "value"}}`,
    }
  }

  // Mark filter as required in schema for query operations
  if (FILTER_OPERATIONS.has(toolId) && !enrichedRequired.includes('filter')) {
    enrichedRequired.push('filter')
  }

  // Enrich sort parameter for query operations
  if (enrichedProperties.sort && toolId === 'table_query_rows') {
    enrichedProperties.sort = {
      ...enrichedProperties.sort,
      description: `Sort order as {field: "asc"|"desc"}. REQUIRED for ranking queries (highest, lowest, Nth). Example: {"salary": "desc"} for highest salary first.`,
    }
  }

  // Enrich limit parameter for query operations
  if (enrichedProperties.limit && toolId === 'table_query_rows') {
    enrichedProperties.limit = {
      ...enrichedProperties.limit,
      description: `Maximum rows to return (min: 1, max: 1000, default: 100). For ranking queries: use limit=1 for highest/lowest, limit=2 for second highest, etc.`,
    }
  }

  // Enrich data parameter for insert/update operations
  if (enrichedProperties.data && DATA_OPERATIONS.has(toolId)) {
    const exampleCols = table.columns.slice(0, 2)
    const exampleData = exampleCols.reduce(
      (obj: Record<string, unknown>, col: { name: string; type: string }) => {
        obj[col.name] = col.type === 'number' ? 123 : col.type === 'boolean' ? true : 'value'
        return obj
      },
      {} as Record<string, unknown>
    )
    enrichedProperties.data = {
      ...enrichedProperties.data,
      description: `REQUIRED object containing row values. Use columns: ${columnNames}. Example value: ${JSON.stringify(exampleData)}`,
    }
  }

  // Enrich rows parameter for batch insert
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
