import { TABLE_LIMITS } from '@/lib/table/constants'
import { selectTableRowSecretProvenance } from '@/lib/table/secret-provenance-selection'
import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import { TABLE_ID_PARAM } from '@/tools/table/params'
import { tableSuccess } from '@/tools/table/response'
import {
  IGNORED_COLUMNS_OUTPUT,
  type TableBatchInsertParams,
  type TableBatchInsertResponse,
} from '@/tools/table/types'
import type { InternalToolConfig } from '@/tools/types'

export const tableBatchInsertRowsTool: InternalToolConfig<
  TableBatchInsertParams,
  TableBatchInsertResponse
> = {
  id: 'table_batch_insert_rows',
  name: 'Batch Insert Rows',
  description: `Insert multiple rows into a table at once (up to ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows)`,
  version: '1.0.0',
  effect: 'write',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc, context) =>
      enrichTableToolSchema(tableId, 'table_batch_insert_rows', schema, desc, context),
  },

  params: {
    tableId: TABLE_ID_PARAM,
    rows: {
      type: 'array',
      required: true,
      description: `Array of row data objects (max ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows)`,
      visibility: 'user-or-llm',
    },
  },

  operation: {
    secretProvenance: {
      request: (params) => selectTableRowSecretProvenance(params.rows, 'rows'),
      response: { incomplete: 'propagate' },
    },
    input: (params: TableBatchInsertParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        tableId: params.tableId,
        rows: params.rows,
        workspaceId,
      }
    },
  },

  /** A dry run's placeholder rows hold the data the call writes; their ids stay placeholders. */
  dryRunOutput: (params) => ({
    rows: params.rows.map((data) => ({ data })),
    insertedCount: params.rows.length,
  }),

  transformResponse: async (response): Promise<TableBatchInsertResponse> => {
    const result = await response.json()
    const data = result.data || result

    return tableSuccess({
      rows: data.rows,
      insertedCount: data.insertedCount,
      message: data.message || 'Rows inserted successfully',
      ignoredColumns: data.ignoredColumns ?? [],
    })
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether rows were inserted' },
    rows: { type: 'array', description: 'Inserted rows data' },
    insertedCount: { type: 'number', description: 'Number of rows inserted' },
    ignoredColumns: IGNORED_COLUMNS_OUTPUT,
    message: { type: 'string', description: 'Status message' },
  },
}
