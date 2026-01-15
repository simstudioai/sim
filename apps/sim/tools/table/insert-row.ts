import type { ToolConfig } from '@/tools/types'
import type { TableRowInsertParams, TableRowResponse } from './types'

export const tableInsertRowTool: ToolConfig<TableRowInsertParams, TableRowResponse> = {
  id: 'table_insert_row',
  name: 'Insert Row',
  description: 'Insert a new row into a table',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    data: {
      type: 'object',
      required: true,
      description: 'Row data as JSON object',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowInsertParams) => `/api/table/${params.tableId}/rows`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableRowInsertParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }

      return {
        data: params.data,
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableRowResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        row: data.row,
        message: data.message || 'Row inserted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was inserted' },
    row: { type: 'json', description: 'Inserted row data' },
    message: { type: 'string', description: 'Status message' },
  },
}
