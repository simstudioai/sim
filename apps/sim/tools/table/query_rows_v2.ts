import type { TableQueryV2Response, TableRowQueryV2Params } from '@/tools/table/types'
import type { ToolConfig } from '@/tools/types'

/**
 * v2 row query: typed predicate grammar + opaque cursor pagination (no offset).
 * Hits POST `/api/table/[tableId]/query`.
 */
export const tableQueryRowsV2Tool: ToolConfig<TableRowQueryV2Params, TableQueryV2Response> = {
  id: 'table_query_rows_v2',
  name: 'Query Rows',
  description:
    'Query rows with a typed predicate filter and cursor pagination. ' +
    'Filter is a predicate tree: `{"all":[{"field":"wins","op":"gte","value":10},{"field":"status","op":"in","value":["active","pending"]}]}` ' +
    '(`all` = AND, `any` = OR; groups nest). Operators: eq, ne, gt, gte, lt, lte, in, nin, like, ilike, ' +
    'nlike, nilike, contains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty. ' +
    'Order is a sort spec, e.g. `[{"field":"wins","direction":"desc"}]`. Omit limit to return the entire result — ' +
    'the query fails if it exceeds the 5MB budget (narrow with a filter or set a limit). With a limit, ' +
    'a page can end early at the byte budget: a non-null nextCursor means more rows exist — pass it back ' +
    'as cursor to continue; never infer completion from page size.',
  version: '1.0.0',

  params: {
    tableId: {
      type: 'string',
      required: true,
      description: 'Table ID',
      visibility: 'user-only',
    },
    filter: {
      type: 'json',
      required: false,
      description:
        'Predicate tree, e.g. `{"all":[{"field":"wins","op":"gte","value":10}]}`. Omit to match all rows.',
      visibility: 'user-or-llm',
    },
    order: {
      type: 'json',
      required: false,
      description: 'Sort spec, e.g. `[{"field":"wins","direction":"desc"}]`.',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description:
        'Maximum rows per page. Omit to return the entire matching result — fails if it exceeds the 5MB budget. With a limit, pages may byte-cut early and set nextCursor when more remain.',
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
        ...(params.filter ? { predicate: params.filter } : {}),
        ...(params.order ? { sort: params.order } : {}),
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
