import type { ToolConfig } from '@/tools/types'
import type { TableDeleteResponse, TableRowDeleteParams } from './types'

export const tableDeleteRowTool: ToolConfig<TableRowDeleteParams, TableDeleteResponse> = {
  id: 'table_delete_row',
  name: 'Delete Row',
  description: 'Delete a row from a table',
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
      description: 'Row ID to delete',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowDeleteParams) => `/api/table/${params.tableId}/rows/${params.rowId}`,
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableRowDeleteParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }

      return {
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableDeleteResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        deletedCount: data.deletedCount,
        message: data.message || 'Row deleted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether row was deleted' },
    deletedCount: { type: 'number', description: 'Number of rows deleted' },
    message: { type: 'string', description: 'Status message' },
  },
}
