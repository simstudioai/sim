import { TABLE_LIMITS } from '@/lib/table/constants'
import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import type { TableBulkOperationResponse, TableDeleteByFilterParams } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

export const tableDeleteRowsByFilterTool: ToolConfig<
  TableDeleteByFilterParams,
  TableBulkOperationResponse
> = {
  id: 'table_delete_rows_by_filter',
  name: 'Delete Rows by Filter',
  description:
    'Delete multiple rows that match filter criteria. Use with caution - supports optional limit for safety.',
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc) =>
      enrichTableToolSchema(tableId, 'table_delete_rows_by_filter', schema, desc),
  },

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
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
      description: `Maximum number of rows to delete (default: no limit, max: ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE})`,
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableDeleteByFilterParams) => `/api/table/${params.tableId}/rows`,
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableDeleteByFilterParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        filter: params.filter,
        limit: params.limit,
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableBulkOperationResponse> => {
    const result = await response.json()
    const data = result.data || result

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
