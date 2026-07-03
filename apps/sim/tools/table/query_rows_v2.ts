import type { TableQueryV2Response, TableRowQueryV2Params } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

/**
 * v2 row query: PostgREST filter grammar + opaque cursor pagination (no offset).
 * Hits POST `/api/table/[tableId]/query`.
 */
export const tableQueryRowsV2Tool: ToolConfig<TableRowQueryV2Params, TableQueryV2Response> = {
  id: 'table_query_rows_v2',
  name: 'Query Rows',
  description:
    'Query rows with a PostgREST filter string and cursor pagination. ' +
    'Filter is a querystring fragment: `wins=gte.10&status=in.(active,pending)` (top-level params AND; ' +
    '`or=(a.eq.1,b.eq.2)` / `and=(...)` for groups). Operators: eq, neq, gt, gte, lt, lte, in, like, ilike, ' +
    'match, imatch, is.null (negate with not., e.g. not.in, not.is.null). ' +
    'Order is PostgREST `order` (e.g. `wins.desc,name.asc`). To page, pass the nextCursor from the previous ' +
    'response back as cursor; omit it for the first page.',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    filter: {
      type: 'string',
      required: false,
      description:
        'PostgREST filter querystring, e.g. `wins=gte.10&status=in.(active,pending)`. Omit to match all rows.',
      visibility: 'user-or-llm',
    },
    order: {
      type: 'string',
      required: false,
      description: 'PostgREST order, e.g. `wins.desc,name.asc`.',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description:
        'Maximum rows to return. Omit to return every matching row (the server fails fast if the result exceeds 10MB). Set a limit to page with the cursor.',
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
        ...(params.filter ? { filter: params.filter } : {}),
        ...(params.order ? { order: params.order } : {}),
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
