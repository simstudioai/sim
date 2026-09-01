import type { TableDeleteResponse, TableRowDeleteParams } from '@/tools/table/types'
import type { InternalToolConfig } from '@/tools/types'

export const tableDeleteRowTool: InternalToolConfig<TableRowDeleteParams, TableDeleteResponse> = {
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

  operation: {
    input: (params: TableRowDeleteParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        tableId: params.tableId,
        rowId: params.rowId,
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
