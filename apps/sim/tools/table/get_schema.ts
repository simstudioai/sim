import { getColumnId } from '@/lib/table/column-keys'
import type { ColumnDefinition } from '@/lib/table/types'
import type { TableGetSchemaParams, TableGetSchemaResponse } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

export const tableGetSchemaTool: ToolConfig<TableGetSchemaParams, TableGetSchemaResponse> = {
  id: 'table_get_schema',
  name: 'Get Schema',
  description: 'Get the schema configuration of a table',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
  },

  request: {
    url: (params: TableGetSchemaParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return `/api/table/${params.tableId}?workspaceId=${encodeURIComponent(workspaceId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<TableGetSchemaResponse> => {
    const result = await response.json()
    const data = result.data || result

    // Always surface a usable `id` per column. Legacy columns predating the id
    // backfill have no stored id; their storage key is the name, so project that
    // as the id rather than leaving it undefined.
    const columns: ColumnDefinition[] = (
      (data.table.schema.columns ?? []) as ColumnDefinition[]
    ).map((col) => ({ ...col, id: getColumnId(col) }))

    return {
      success: true,
      output: {
        name: data.table.name,
        columns,
        columnCount: columns.length,
        rowCount: data.table.rowCount ?? 0,
        maxRows: data.table.maxRows ?? 0,
        message: data.message || 'Schema retrieved successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether schema was retrieved' },
    name: { type: 'string', description: 'Table name' },
    columns: { type: 'array', description: 'Column definitions (each includes its stable id)' },
    columnCount: { type: 'number', description: 'Number of columns' },
    rowCount: { type: 'number', description: 'Number of rows in the table' },
    maxRows: {
      type: 'number',
      description: "Max rows per table for the workspace's plan",
    },
    message: { type: 'string', description: 'Status message' },
  },
}
