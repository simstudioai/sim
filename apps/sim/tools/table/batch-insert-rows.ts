import { TABLE_LIMITS } from '@/lib/table/constants'
import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import type { ToolConfig } from '@/tools/types'
import type { TableBatchInsertParams, TableBatchInsertResponse } from './types'

export const tableBatchInsertRowsTool: ToolConfig<
  TableBatchInsertParams,
  TableBatchInsertResponse
> = {
  id: 'table_batch_insert_rows',
  name: 'Batch Insert Rows',
  description: `Insert multiple rows into a table at once (up to ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows)`,
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc) =>
      enrichTableToolSchema(tableId, 'table_batch_insert_rows', schema, desc),
  },

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    rows: {
      type: 'array',
      required: true,
      description: `Array of row data objects (max ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows)`,
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableBatchInsertParams) => `/api/table/${params.tableId}/rows`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: TableBatchInsertParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
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
