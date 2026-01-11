import type { InsForgeQueryParams, InsForgeQueryResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<InsForgeQueryParams, InsForgeQueryResponse> = {
  id: 'insforge_query',
  name: 'InsForge Query',
  description: 'Query data from an InsForge database table',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the table to query',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PostgREST filter (e.g., "id=eq.123")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Column to order by (add DESC for descending)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      let url = `${base}/api/database/${params.table}?select=*`

      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      if (params.orderBy) {
        let orderParam = params.orderBy.trim()
        if (/\s+DESC$/i.test(orderParam)) {
          orderParam = `${orderParam.replace(/\s+DESC$/i, '').trim()}.desc`
        } else if (/\s+ASC$/i.test(orderParam)) {
          orderParam = `${orderParam.replace(/\s+ASC$/i, '').trim()}.asc`
        } else {
          orderParam = `${orderParam}.asc`
        }
        url += `&order=${orderParam}`
      }

      if (params.limit) {
        url += `&limit=${Number(params.limit)}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge response: ${parseError}`)
    }

    const rowCount = Array.isArray(data) ? data.length : 0

    if (rowCount === 0) {
      return {
        success: true,
        output: {
          message: 'No rows found matching the query criteria',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully queried ${rowCount} row${rowCount === 1 ? '' : 's'} from InsForge`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of records returned from the query' },
  },
}
