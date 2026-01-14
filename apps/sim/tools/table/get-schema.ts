import type { ToolConfig } from '@/tools/types'
import type { TableGetSchemaParams, TableGetSchemaResponse } from './types'

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
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
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

    return {
      success: true,
      output: {
        name: data.table.name,
        columns: data.table.schema.columns,
        message: data.message || 'Schema retrieved successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether schema was retrieved' },
    name: { type: 'string', description: 'Table name' },
    columns: { type: 'array', description: 'Column definitions' },
    message: { type: 'string', description: 'Status message' },
  },
}
