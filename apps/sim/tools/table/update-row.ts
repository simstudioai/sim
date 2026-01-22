import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import type { ToolConfig } from '@/tools/types'
import type { TableRowResponse, TableRowUpdateParams } from './types'

export const tableUpdateRowTool: ToolConfig<TableRowUpdateParams, TableRowResponse> = {
  id: 'table_update_row',
  name: 'Update Row',
  description:
    'Update an existing row in a table. Supports partial updates - only include the fields you want to change. IMPORTANT: You must use the "data" parameter (not "values", "row", "fields", or other variations) to specify the fields to update.',
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc) =>
      enrichTableToolSchema(tableId, 'table_update_row', schema, desc),
  },

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
    url: (params: TableRowUpdateParams) => `/api/table/${params.tableId}/rows/${params.rowId}`,
    method: 'PATCH',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableRowUpdateParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
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
