import type { TableRow } from '@/lib/table'
import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TableRowInsertParams } from './types'

interface TableUpsertResponse extends ToolResponse {
  output: {
    row: TableRow
    operation: 'insert' | 'update'
    message: string
  }
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
      visibility: 'user-only',
    },
    data: {
      type: 'object',
      required: true,
      description: 'Row data to insert or update',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowInsertParams) => `/api/table/${params.tableId}/rows/upsert`,
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

  transformResponse: async (response): Promise<TableUpsertResponse> => {
    const result = await response.json()
    const data = result.data || result

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
