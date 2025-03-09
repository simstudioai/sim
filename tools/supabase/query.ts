import { ToolConfig } from '../types'
import { SupabaseQueryParams, SupabaseQueryResponse } from './types'

export const queryTool: ToolConfig<SupabaseQueryParams, SupabaseQueryResponse> = {
  id: 'supabase_query',
  name: 'Supabase Query',
  description: 'Query data from a Supabase table',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'supabase',
    additionalScopes: ['database.read', 'projects.read'],
  },
  params: {
    credential: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    table: { type: 'string', required: true },
    select: { type: 'string', required: false },
    filter: { type: 'object', required: false },
  },
  request: {
    url: (params) =>
      `https://api.supabase.com/v1/projects/${params.projectId}/tables/${params.table}/query`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.credential}`,
    }),
    body: (params) => ({
      select: params.select || '*',
      filter: params.filter,
    }),
  },
  directExecution: async (params: SupabaseQueryParams) => {
    try {
      // This is a mock implementation
      console.log(`Querying Supabase table ${params.table} in project ${params.projectId}`)

      // Mock response
      const mockData = [
        { id: 1, name: 'Item 1', description: 'Description 1' },
        { id: 2, name: 'Item 2', description: 'Description 2' },
      ]

      return {
        success: true,
        output: {
          message: `Successfully queried data from ${params.table}`,
          results: mockData,
        },
        data: mockData,
        error: null,
      }
    } catch (error) {
      console.error('Error querying Supabase:', error)
      return {
        success: false,
        output: {
          message: `Error querying Supabase: ${error instanceof Error ? error.message : String(error)}`,
        },
        data: [],
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
      severity: 'info',
      data: data,
      error: null,
    }
  },
  transformError: (error: any) => {
    return error.message || 'An error occurred while querying Supabase'
  },
}
