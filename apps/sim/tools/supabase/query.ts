import type { ToolConfig } from '../types'
import type { SupabaseQueryParams, SupabaseQueryResponse } from './types'

export const queryTool: ToolConfig<SupabaseQueryParams, SupabaseQueryResponse> = {
  id: 'supabase_query',
  name: 'Supabase Query',
  description: 'Query data from a Supabase table',
  version: '1.0',
  oauth: {
    required: false,
    provider: 'supabase',
    additionalScopes: ['database.read', 'projects.read'],
  },
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
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to apply to the query',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase client anon key',
    },
  },
  request: {
    url: (params) => `https://${params.projectId}.supabase.co/rest/v1/${params.table}`,
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },
  directExecution: async (params: SupabaseQueryParams) => {
    try {
      // Construct the URL for the Supabase REST API
      const url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

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

      return {
        success: true,
        output: {
          message: `Successfully queried data from ${params.table}`,
          results: data,
        },
        error: undefined,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: `Error querying Supabase: ${error instanceof Error ? error.message : String(error)}`,
          results: [],
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to query data from Supabase')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        message: 'Successfully queried data from Supabase',
        results: data,
      },
      error: undefined,
    }
  },
  transformError: (error: any) => {
    return error.message || 'An error occurred while querying Supabase'
  },
}
