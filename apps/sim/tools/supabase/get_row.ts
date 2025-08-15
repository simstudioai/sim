import type { SupabaseGetRowParams, SupabaseGetRowResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const getRowTool: ToolConfig<SupabaseGetRowParams, SupabaseGetRowResponse> = {
  id: 'supabase_get_row',
  name: 'Supabase Get Row',
  description: 'Get a single row from a Supabase table based on filter criteria',
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
      visibility: 'user-only',
      description: 'The name of the Supabase table to query',
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
      visibility: 'hidden',
      description: 'Your Supabase service role secret key',
    },
  },

  request: {
    url: (params) => {
      // Construct the URL for the Supabase REST API
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters (required for get_row) - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      // Limit to 1 row since we want a single row
      url += `&limit=1`

      return url
    },
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const row = data.length > 0 ? data[0] : null

    return {
      success: true,
      output: {
        message: row ? 'Successfully found row' : 'No row found matching the criteria',
        results: row,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'object', description: 'The row data if found, null if not found' },
  },
}
