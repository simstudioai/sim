import type { InsForgeGetRowParams, InsForgeGetRowResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const getRowTool: ToolConfig<InsForgeGetRowParams, InsForgeGetRowResponse> = {
  id: 'insforge_get_row',
  name: 'InsForge Get Row',
  description: 'Get a single row from an InsForge database table based on filter criteria',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'PostgREST filter to find the specific row (e.g., "id=eq.123")',
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
      let url = `${base}/api/database/records/${encodeURIComponent(params.table)}?select=*`

      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      url += '&limit=1'
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
          message: 'No row found matching the filter criteria',
          results: [],
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: 'Successfully retrieved row from InsForge',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'array',
      description: 'Array containing the row data if found, empty array if not found',
    },
  },
}
