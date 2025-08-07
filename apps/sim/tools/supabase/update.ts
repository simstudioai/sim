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
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Update operation results',
      properties: {
        message: { type: 'string', description: 'Operation status message' },
        results: { type: 'array', description: 'Array of updated records' },
      },
    },
    error: { type: 'string', description: 'Error message if the operation failed' },
  },
  request: {
    url: (params) => `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`,
    method: 'PATCH',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
  },
  directExecution: async (params: SupabaseUpdateParams) => {
    try {
      // Construct the URL for the Supabase REST API with select to return updated data
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters (required for update) - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      // Fetch the data
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          apikey: params.apiKey,
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(params.data),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error from Supabase: ${response.status} ${errorText}`)
      }

      // Handle potentially empty response from update operations
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
        // Empty response means successful update
        data = []
      }

      const updatedCount = Array.isArray(data) ? data.length : text ? 1 : 0

      return {
        success: true,
        output: {
          message: `Successfully updated ${updatedCount === 0 ? 'row(s)' : `${updatedCount} row(s)`} in ${params.table}`,
          results: data,
        },
        error: undefined,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: `Error updating rows in Supabase: ${error instanceof Error ? error.message : String(error)}`,
          results: null,
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to update rows in Supabase')
    }

    // Handle potentially empty response from update operations
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
      // Empty response means successful update
      data = []
    }

    const updatedCount = Array.isArray(data) ? data.length : text ? 1 : 0

    return {
      success: true,
      output: {
        message: `Successfully updated ${updatedCount === 0 ? 'row(s)' : `${updatedCount} row(s)`}`,
        results: data,
      },
      error: undefined,
    }
  },
  transformError: (error: any) => {
    return error.message || 'An error occurred while updating rows in Supabase'
  },
}
