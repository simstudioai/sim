import type { ToolConfig } from '../types'
import type { SupabaseInsertParams, SupabaseInsertResponse } from './types'

export const insertTool: ToolConfig<SupabaseInsertParams, SupabaseInsertResponse> = {
  id: 'supabase_insert',
  name: 'Supabase Insert',
  description: 'Insert data into a Supabase table',
  version: '1.0',
  oauth: {
    required: false,
    provider: 'supabase',
    additionalScopes: ['database.write', 'projects.read'],
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
      description: 'The name of the Supabase table to insert data into',
    },
    data: {
      type: 'any',
      required: true,
      visibility: 'user-or-llm',
      description: 'The data to insert',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase client anon key',
    },
  },
  request: {
    url: (params) => `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`,
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: (params) => {
      // If data is an object but not an array, wrap it in an array
      if (typeof params.data === 'object' && !Array.isArray(params.data)) {
        return [params.data]
      }
      // If it's already an array, return as is
      return params.data
    },
  },
  directExecution: async (params: SupabaseInsertParams) => {
    try {
      // Construct the URL for the Supabase REST API with select=* to return inserted data
      const url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Prepare the data - if it's an object but not an array, wrap it in an array
      const dataToSend =
        typeof params.data === 'object' && !Array.isArray(params.data) ? [params.data] : params.data

      // Insert the data
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: params.apiKey,
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(dataToSend),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error from Supabase: ${response.status} ${errorText}`)
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          message: `Successfully inserted data into ${params.table}`,
          results: data,
        },
        error: undefined,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: `Error inserting into Supabase: ${error instanceof Error ? error.message : String(error)}`,
          results: [],
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to insert data into Supabase')
    }

    // Handle empty response case
    const text = await response.text()
    if (!text || text.trim() === '') {
      return {
        success: true,
        output: {
          message: 'Successfully inserted data into Supabase (no data returned)',
          results: [],
        },
        error: undefined,
      }
    }

    const data = JSON.parse(text)

    return {
      success: true,
      output: {
        message: 'Successfully inserted data into Supabase',
        results: data,
      },
      error: undefined,
    }
  },
  transformError: (error: any) => {
    return error.message || 'An error occurred while inserting data into Supabase'
  },
}
