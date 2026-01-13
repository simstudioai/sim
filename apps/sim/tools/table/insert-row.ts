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
      visibility: 'user-or-llm',
    },
    data: {
      type: 'object',
      required: true,
      description: 'Row data as JSON object',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => `/api/table/${params.tableId}/rows`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: any) => {
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
    const data = await response.json()

    if (!response.ok) {
      let errorMessage = data.error || 'Failed to insert row'

      // Include details array if present
      if (data.details) {
        if (Array.isArray(data.details) && data.details.length > 0) {
          const detailsStr = data.details.join('; ')
          errorMessage = `${errorMessage}: ${detailsStr}`
        } else if (typeof data.details === 'string') {
          errorMessage = `${errorMessage}: ${data.details}`
        }
      }

      throw new Error(errorMessage)
    }

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
