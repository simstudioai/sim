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
    url: (params) => `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`,
    method: 'DELETE',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      Prefer: 'return=representation',
    }),
  },
  directExecution: async (params: SupabaseDeleteParams) => {
    try {
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

      // Fetch the data
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          apikey: params.apiKey,
          Authorization: `Bearer ${params.apiKey}`,
          Prefer: 'return=representation',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error from Supabase: ${response.status} ${errorText}`)
      }

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
          message: `Successfully deleted ${deletedCount === 0 ? 'row(s)' : `${deletedCount} row(s)`} from ${params.table}`,
          results: data,
        },
        error: undefined,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: `Error deleting rows from Supabase: ${error instanceof Error ? error.message : String(error)}`,
          results: null,
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to delete rows from Supabase')
    }

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
  transformError: (error: any) => {
    return error.message || 'An error occurred while deleting rows from Supabase'
  },
}
