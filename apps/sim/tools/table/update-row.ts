import type { ToolConfig } from '@/tools/types'
import type { TableRowResponse, TableRowUpdateParams } from './types'

export const tableUpdateRowTool: ToolConfig<TableRowUpdateParams, TableRowResponse> = {
  id: 'table_update_row',
  name: 'Update Row',
  description: 'Update an existing row in a table',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-or-llm',
    },
    rowId: {
      type: 'string',
      required: true,
      description: 'Row ID to update',
      visibility: 'user-or-llm',
    },
    data: {
      type: 'object',
      required: true,
      description: 'Updated row data',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => `/api/table/${params.tableId}/rows/${params.rowId}`,
    method: 'PATCH',
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

    return {
      success: true,
      output: {
        row: data.row,
        message: data.message || 'Row updated successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was updated' },
    row: { type: 'json', description: 'Updated row data' },
    message: { type: 'string', description: 'Status message' },
  },
}
