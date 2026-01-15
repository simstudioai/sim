import { createLogger } from '@sim/logger'
import type { TableSchema } from '@/lib/table/types'

const logger = createLogger('TableSchemaContext')

interface TableSchemaResponse {
  data?: {
    table?: {
      id: string
      name?: string | null
      schema?: TableSchema
    }
  }
  table?: {
    id: string
    name?: string | null
    schema?: TableSchema
  }
}

/**
 * Fetches table schema context for wand generation.
 */
export async function fetchTableSchemaContext({
  tableId,
  workspaceId,
}: {
  tableId?: string | null
  workspaceId?: string | null
}): Promise<string | null> {
  if (!tableId || !workspaceId) {
    return null
  }

  try {
    const response = await fetch(`/api/table/${tableId}?workspaceId=${workspaceId}`)
    if (!response.ok) {
      return null
    }

    const result = (await response.json()) as TableSchemaResponse
    const table = result.data?.table ?? result.table
    const schema = table?.schema

    if (!table || !schema || !schema.columns || schema.columns.length === 0) {
      return null
    }

    const columnLines = schema.columns
      .map((column) => {
        const flags = [
          column.type,
          column.required ? 'required' : null,
          column.unique ? 'unique' : null,
        ].filter(Boolean)
        const descriptor = flags.length ? ` (${flags.join(', ')})` : ''
        return `- ${column.name}${descriptor}`
      })
      .join('\n')

    const tableLabel = table.name ? `${table.name} (${table.id})` : table.id

    return `Table schema for ${tableLabel}:\n${columnLines}\nBuilt-in columns: createdAt, updatedAt`
  } catch (error) {
    logger.debug('Failed to fetch table schema for wand context', { tableId, error })
    return null
  }
}
