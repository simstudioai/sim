import type { ToolConfig } from '@/tools/types'
import type { TableRowInsertParams, TableRowResponse } from './types'

interface TableUpsertResponse extends TableRowResponse {
  operation?: 'insert' | 'update'
}

export const tableUpsertRowTool: ToolConfig<TableRowInsertParams, TableUpsertResponse> = {
  id: 'table_upsert_row',
  name: 'Upsert Row',
  description:
    'Insert or update a row based on unique column constraints. If a row with matching unique field exists, update it; otherwise insert a new row.',
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
      description: 'Row data to insert or update',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => `/api/table/${params.tableId}/rows/upsert`,
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

  transformResponse: async (response): Promise<TableUpsertResponse> => {
    const data = await response.json()

    if (!response.ok) {
      let errorMessage = data.error || 'Failed to upsert row'

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
        operation: data.operation,
        message: data.message || 'Row upserted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was upserted' },
    row: { type: 'json', description: 'Upserted row data' },
    operation: { type: 'string', description: 'Operation performed: insert or update' },
    message: { type: 'string', description: 'Status message' },
  },
}
