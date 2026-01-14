import type { ToolConfig } from '@/tools/types'
import type { TableBulkOperationResponse, TableDeleteByFilterParams } from './types'

export const tableDeleteRowsByFilterTool: ToolConfig<
  TableDeleteByFilterParams,
  TableBulkOperationResponse
> = {
  id: 'table_delete_rows_by_filter',
  name: 'Delete Rows by Filter',
  description:
    'Delete multiple rows that match filter criteria. Use with caution - supports optional limit for safety.',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-or-llm',
    },
    filter: {
      type: 'object',
      required: true,
      description: 'Filter criteria using operators like $eq, $ne, $gt, $lt, $contains, $in, etc.',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of rows to delete (default: no limit, max: 1000)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => `/api/table/${params.tableId}/rows`,
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: any) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }

      return {
        filter: params.filter,
        limit: params.limit,
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableBulkOperationResponse> => {
    const data = await response.json()

    return {
      success: true,
      output: {
        deletedCount: data.deletedCount || 0,
        deletedRowIds: data.deletedRowIds || [],
        message: data.message || 'Rows deleted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether rows were deleted' },
    deletedCount: { type: 'number', description: 'Number of rows deleted' },
    deletedRowIds: { type: 'array', description: 'IDs of deleted rows' },
    message: { type: 'string', description: 'Status message' },
  },
}
