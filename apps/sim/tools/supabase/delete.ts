import type { SupabaseDeleteParams, SupabaseDeleteResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<SupabaseDeleteParams, SupabaseDeleteResponse> = {
  id: 'supabase_delete',
  name: 'Supabase Delete Row',
  description: 'Delete rows from a Supabase table based on filter criteria',
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
      description: 'The name of the Supabase table to delete from',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostgREST filter to identify rows to delete (e.g., "id=eq.123")',
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
      // Construct the URL for the Supabase REST API with select to return deleted data
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters (required for delete) - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      } else {
        throw new Error(
          'Filter is required for delete operations to prevent accidental deletion of all rows'
        )
      }

      return url
    },
    method: 'DELETE',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      Prefer: 'return=representation',
    }),
  },

  transformResponse: async (response: Response) => {
    // Handle empty response from delete operations
    const text = await response.text()
    let data

    if (text?.trim()) {
      try {
        data = JSON.parse(text)
      } catch (e) {
        // If we can't parse it, just use the text
        data = text
      }
    } else {
      // Empty response means successful deletion
      data = []
    }

    const deletedCount = Array.isArray(data) ? data.length : text ? 1 : 0

    return {
      success: true,
      output: {
        message: `Successfully deleted ${deletedCount === 0 ? 'row(s)' : `${deletedCount} row(s)`}`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of deleted records' },
  },
}
