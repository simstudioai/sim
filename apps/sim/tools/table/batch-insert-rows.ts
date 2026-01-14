import type { ToolConfig } from '@/tools/types'
import type { TableBatchInsertParams, TableBatchInsertResponse } from './types'

export const tableBatchInsertRowsTool: ToolConfig<
  TableBatchInsertParams,
  TableBatchInsertResponse
> = {
  id: 'table_batch_insert_rows',
  name: 'Batch Insert Rows',
  description: 'Insert multiple rows into a table at once (up to 1000 rows)',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-or-llm',
    },
    rows: {
      type: 'array',
      required: true,
      description: 'Array of row data objects (max 1000 rows)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: any) => `/api/table/${params.tableId}/rows`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: any) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }

      return {
        rows: params.rows,
        workspaceId,
      }
    },
  },

  transformResponse: async (response): Promise<TableBatchInsertResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        rows: data.rows,
        insertedCount: data.insertedCount,
        message: data.message || 'Rows inserted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether rows were inserted' },
    rows: { type: 'array', description: 'Inserted rows data' },
    insertedCount: { type: 'number', description: 'Number of rows inserted' },
    message: { type: 'string', description: 'Status message' },
  },
}
