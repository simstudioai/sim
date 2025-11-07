import type { SupabaseCountParams, SupabaseCountResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const countTool: ToolConfig<SupabaseCountParams, SupabaseCountResponse> = {
  id: 'supabase_count',
  name: 'Supabase Count',
  description: 'Count rows in a Supabase table',
  version: '1.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the Supabase table to count rows from',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PostgREST filter (e.g., "status=eq.active")',
    },
    countType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Count type: exact, planned, or estimated (default: exact)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  request: {
    url: (params) => {
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters if provided
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      return url
    },
    method: 'HEAD',
    headers: (params) => {
      const countType = params.countType || 'exact'
      return {
        apikey: params.apiKey,
        Authorization: `Bearer ${params.apiKey}`,
        Prefer: `count=${countType}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    // Extract count from Content-Range header
    const contentRange = response.headers.get('content-range')

    if (!contentRange) {
      throw new Error('No content-range header found in response')
    }

    // Parse the content-range header (format: "0-9/100" or "*/100")
    const countMatch = contentRange.match(/\/(\d+)$/)

    if (!countMatch) {
      throw new Error(`Invalid content-range header format: ${contentRange}`)
    }

    const count = Number.parseInt(countMatch[1], 10)

    return {
      success: true,
      output: {
        message: `Successfully counted ${count} row${count === 1 ? '' : 's'}`,
        count: count,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    count: { type: 'number', description: 'Number of rows matching the filter' },
  },
}
