import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import type { TableRowInsertParams, TableRowResponse } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

export const tableInsertRowTool: ToolConfig<TableRowInsertParams, TableRowResponse> = {
  id: 'table_insert_row',
  name: 'Insert Row',
  description:
    'Insert a new row into a table. IMPORTANT: You must use the "data" parameter (not "values", "row", "fields", or other variations) to specify the row contents.',
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc) =>
      enrichTableToolSchema(tableId, 'table_insert_row', schema, desc),
  },

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    data: {
      type: 'object',
      required: true,
      description: 'Row data as JSON object',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowInsertParams) => `/api/table/${params.tableId}/rows`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableRowInsertParams) => {
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
