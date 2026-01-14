import type { ToolConfig } from '@/tools/types'
import type { TableBulkOperationResponse, TableUpdateByFilterParams } from './types'

export const tableUpdateRowsByFilterTool: ToolConfig<
  TableUpdateByFilterParams,
  TableBulkOperationResponse
> = {
  id: 'table_update_rows_by_filter',
  name: 'Update Rows by Filter',
  description:
    'Update multiple rows that match filter criteria. Data is merged with existing row data.',
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
    data: {
      type: 'object',
      required: true,
      description: 'Fields to update (merged with existing data)',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of rows to update (default: no limit, max: 1000)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => `/api/table/${params.tableId}/rows`,
    method: 'PUT',
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
        data: params.data,
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
        updatedCount: data.updatedCount || 0,
        updatedRowIds: data.updatedRowIds || [],
        message: data.message || 'Rows updated successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether rows were updated' },
    updatedCount: { type: 'number', description: 'Number of rows updated' },
    updatedRowIds: { type: 'array', description: 'IDs of updated rows' },
    message: { type: 'string', description: 'Status message' },
  },
}
