import { ToolConfig } from '../types'
import { SupabaseInsertParams, SupabaseInsertResponse } from './types'

export const insertTool: ToolConfig<SupabaseInsertParams, SupabaseInsertResponse> = {
  id: 'supabase_insert',
  name: 'Supabase Insert',
  description: 'Insert data into a Supabase table',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'supabase',
    additionalScopes: ['database.write', 'projects.read'],
  },
  params: {
    credential: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    table: { type: 'string', required: true },
    data: { type: 'object', required: true },
  },
  request: {
    url: (params) =>
      `https://api.supabase.com/v1/projects/${params.projectId}/tables/${params.table}/insert`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.credential}`,
    }),
    body: (params) => ({
      data: params.data,
    }),
  },
  directExecution: async (params: SupabaseInsertParams) => {
    try {
      // Mock response
      const mockData = [{ ...params.data, id: Math.floor(Math.random() * 1000) }]

      return {
        success: true,
        output: {
          message: `Successfully inserted data into ${params.table}`,
          results: mockData,
        },
        data: mockData,
        error: null,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: `Error inserting into Supabase: ${error instanceof Error ? error.message : String(error)}`,
        },
        data: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to insert data into Supabase')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        message: 'Successfully inserted data into Supabase',
        results: data,
      },
      severity: 'info',
      data: data,
      error: null,
    }
  },
  transformError: (error: any) => {
    return error.message || 'An error occurred while inserting data into Supabase'
  },
}
