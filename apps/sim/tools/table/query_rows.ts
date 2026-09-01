import { enrichTableToolSchema } from '@/tools/schema-enrichers'
import type { TableQueryResponse, TableRowQueryParams } from '@/tools/table/types'
import type { InternalToolConfig } from '@/tools/types'

export const tableQueryRowsTool: InternalToolConfig<TableRowQueryParams, TableQueryResponse> = {
  id: 'table_query_rows',
  name: 'Query Rows',
  description: 'Query rows from a table with filtering, sorting, and pagination',
  version: '1.0.0',

  toolEnrichment: {
    dependsOn: 'tableId',
    enrichTool: (tableId, schema, desc, context) =>
      enrichTableToolSchema(tableId, 'table_query_rows', schema, desc, context),
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
      required: false,
      description:
        'Filter conditions (MongoDB-style operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $contains, $ncontains, $startsWith, $endsWith, $empty)',
      visibility: 'user-or-llm',
    },
    sort: {
      type: 'object',
      required: false,
      description: 'Sort order as {field: "asc"|"desc"}',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description:
        'Maximum rows to return. Omit to return every matching row; the query fails if the result exceeds the 5MB response budget.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'number',
      required: false,
      description: 'Number of rows to skip (default: 0)',
      visibility: 'user-or-llm',
    },
  },

  operation: {
    secretProvenance: { response: { incomplete: 'propagate' } },
    input: (params: TableRowQueryParams) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }

      return {
        tableId: params.tableId,
        workspaceId,
        ...(params.filter ? { filter: JSON.stringify(params.filter) } : {}),
        ...(params.sort ? { sort: JSON.stringify(params.sort) } : {}),
        ...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
        ...(params.offset !== undefined ? { offset: String(params.offset) } : {}),
      }
    },
  },

  transformResponse: async (response): Promise<TableQueryResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        rows: data.rows,
        rowCount: data.rowCount,
        totalCount: data.totalCount,
        limit: data.limit,
        offset: data.offset,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether query succeeded' },
    rows: { type: 'array', description: 'Query result rows' },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    totalCount: { type: 'number', description: 'Total rows matching filter' },
    limit: { type: 'number', description: 'Limit used in query' },
    offset: { type: 'number', description: 'Offset used in query' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description:
        'Non-null when more rows match past this page. A page can end early at the byte budget, so this — not a short rowCount — is what says whether more remain. To page, advance offset by rowCount and stop when this is null.',
    },
  },
}
