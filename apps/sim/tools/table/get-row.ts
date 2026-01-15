import type { ToolConfig } from '@/tools/types'
import type { TableRowGetParams, TableRowResponse } from './types'

export const tableGetRowTool: ToolConfig<TableRowGetParams, TableRowResponse> = {
  id: 'table_get_row',
  name: 'Get Row',
  description: 'Get a single row by ID',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    rowId: {
      type: 'string',
      required: true,
      description: 'Row ID to retrieve',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowGetParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }

      return `/api/table/${params.tableId}/rows/${params.rowId}?workspaceId=${encodeURIComponent(workspaceId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<TableRowResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        row: data.row,
        message: data.message || 'Row retrieved successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was retrieved' },
    row: { type: 'json', description: 'Row data' },
    message: { type: 'string', description: 'Status message' },
  },
}
