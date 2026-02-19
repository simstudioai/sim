import { TABLE_LIMITS } from '@/lib/table/constants'
import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import type { TableBulkOperationResponse, TableUpdateByFilterParams } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

export const tableUpdateRowsByFilterTool: ToolConfig<
  TableUpdateByFilterParams,
  TableBulkOperationResponse
> = {
  id: 'table_update_rows_by_filter',
  name: 'Update Rows by Filter',
  description:
    'Update multiple rows that match filter criteria. Data is merged with existing row data.',
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc) =>
      enrichTableToolSchema(tableId, 'table_update_rows_by_filter', schema, desc),
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
    data: {
      type: 'object',
      required: true,
      description: 'Fields to update (merged with existing data)',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description: `Maximum number of rows to update (default: no limit, max: ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE})`,
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableUpdateByFilterParams) => `/api/table/${params.tableId}/rows`,
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableUpdateByFilterParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
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
    const result = await response.json()
    const data = result.data || result

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
