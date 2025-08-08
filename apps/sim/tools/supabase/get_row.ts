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
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Get row operation results',
      properties: {
        message: { type: 'string', description: 'Operation status message' },
        results: { type: 'object', description: 'The row data if found, null if not found' },
      },
    },
    error: { type: 'string', description: 'Error message if the operation failed' },
  },
  request: {
    url: (params) => `https://${params.projectId}.supabase.co/rest/v1/${params.table}`,
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },
  directExecution: async (params: SupabaseGetRowParams) => {
    try {
      // Construct the URL for the Supabase REST API
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters (required for get_row) - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      // Limit to 1 row since we want a single row
      url += `&limit=1`

      // Fetch the data
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          apikey: params.apiKey,
          Authorization: `Bearer ${params.apiKey}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error from Supabase: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      const row = data.length > 0 ? data[0] : null

      return {
        success: true,
        output: {
          message: row
            ? `Successfully found row in ${params.table}`
            : `No row found in ${params.table} matching the criteria`,
          results: row,
        },
        error: undefined,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: `Error getting row from Supabase: ${error instanceof Error ? error.message : String(error)}`,
          results: null,
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to get row from Supabase')
    }

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
  transformError: (error: any) => {
    return error.message || 'An error occurred while getting row from Supabase'
  },
}
