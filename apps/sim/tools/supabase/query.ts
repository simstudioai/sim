import type { SupabaseQueryParams, SupabaseQueryResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const queryTool: ToolConfig<SupabaseQueryParams, SupabaseQueryResponse> = {
  id: 'supabase_query',
  name: 'Supabase Query',
  description: 'Query data from a Supabase table',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'PostgREST filter (e.g., "id=eq.2", "name=not.is.null", "age=gt.18&status=eq.active")',
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
      visibility: 'hidden',
      description: 'Your Supabase service role secret key',
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
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Add filters if provided - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      // Add order by if provided
      if (params.orderBy) {
        const orderParam = params.orderBy.includes('DESC')
          ? `${params.orderBy.replace(' DESC', '').replace('DESC', '')}.desc`
          : `${params.orderBy}.asc`
        url += `&order=${orderParam}`
      }

      // Add limit if provided
      if (params.limit) {
        url += `&limit=${params.limit}`
      }

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
          message: `Successfully queried ${data.length} row(s) from ${params.table}`,
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
