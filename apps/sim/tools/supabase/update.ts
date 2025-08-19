import type { SupabaseUpdateParams, SupabaseUpdateResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<SupabaseUpdateParams, SupabaseUpdateResponse> = {
  id: 'supabase_update',
  name: 'Supabase Update Row',
  description: 'Update rows in a Supabase table based on filter criteria',
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
      description: 'The name of the Supabase table to update',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostgREST filter to identify rows to update (e.g., "id=eq.123")',
    },
    data: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data to update in the matching rows',
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
      // Construct the URL for the Supabase REST API with select to return updated data
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters (required for update) - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      return url
    },
    method: 'PATCH',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: (params) => params.data,
  },

  transformResponse: async (response: Response) => {
    const text = await response.text()
    let data

    if (text?.trim()) {
      try {
        data = JSON.parse(text)
      } catch (parseError) {
        throw new Error(`Failed to parse Supabase response: ${parseError}`)
      }
    } else {
      data = []
    }

    const updatedCount = Array.isArray(data) ? data.length : 0

    if (updatedCount === 0) {
      return {
        success: true,
        output: {
          message: 'No rows were updated (no matching records found)',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully updated ${updatedCount} row${updatedCount === 1 ? '' : 's'}`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of updated records' },
  },
}
