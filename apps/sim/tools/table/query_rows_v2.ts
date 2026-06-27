import { TABLE_LIMITS } from '@/lib/table/constants'
import type { TableQueryV2Response, TableRowQueryV2Params } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

/**
 * v2 row query: a structured `all`/`any` predicate grammar and opaque cursor
 * pagination (no offset). Hits POST `/api/table/[tableId]/query`.
 */
export const tableQueryRowsV2Tool: ToolConfig<TableRowQueryV2Params, TableQueryV2Response> = {
  id: 'table_query_rows_v2',
  name: 'Query Rows',
  description:
    'Query rows with a structured predicate and cursor pagination. The predicate is a nestable tree: ' +
    '{ "all": [ { "field": "status", "op": "eq", "value": "active" } ] } (all = AND, any = OR). ' +
    'Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, isEmpty, isNotEmpty. ' +
    'To page, pass the nextCursor from the previous response back as cursor; omit it for the first page.',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    predicate: {
      type: 'json',
      required: false,
      description:
        'Nestable predicate tree of { all | any: [...] } groups and { field, op, value } leaves. Omit to match all rows.',
      visibility: 'user-or-llm',
    },
    sort: {
      type: 'json',
      required: false,
      description: 'Ordered list of { field, direction: "asc" | "desc" }.',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description: `Maximum rows to return (default: ${TABLE_LIMITS.DEFAULT_QUERY_LIMIT}, max: ${TABLE_LIMITS.MAX_QUERY_LIMIT})`,
      visibility: 'user-or-llm',
    },
    cursor: {
      type: 'string',
      required: false,
      description: 'Opaque pagination cursor returned by a prior query. Omit for the first page.',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params: TableRowQueryV2Params) => `/api/table/${params.tableId}/query`,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params: TableRowQueryV2Params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('Workspace ID is required in execution context')
      }
      return {
        workspaceId,
        ...(params.predicate ? { predicate: params.predicate } : {}),
        ...(params.sort ? { sort: params.sort } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      }
    },
  },

  transformResponse: async (response): Promise<TableQueryV2Response> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: true,
      output: {
        rows: data.rows,
        rowCount: data.rowCount,
        totalCount: data.totalCount,
        limit: data.limit,
        nextCursor: data.nextCursor,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the query succeeded' },
    rows: { type: 'array', description: 'Query result rows' },
    rowCount: { type: 'number', description: 'Number of rows returned' },
    totalCount: {
      type: 'number',
      description: 'Total rows matching the predicate (computed on the first page only)',
    },
    limit: { type: 'number', description: 'Limit used in the query' },
    nextCursor: {
      type: 'string',
      description: 'Cursor to fetch the next page, or null on the last page',
    },
  },
}
