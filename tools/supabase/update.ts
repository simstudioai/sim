import { ToolConfig } from '../types'
import { SupabaseUpdateParams, SupabaseUpdateResponse } from './types'

export const updateTool: ToolConfig<SupabaseUpdateParams, SupabaseUpdateResponse> = {
  id: 'supabase_update',
  name: 'Supabase Update',
  description: 'Update data in a Supabase table',
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
    filter: { type: 'object', required: true },
  },
  request: {
    url: (params) =>
      `https://api.supabase.com/v1/projects/${params.projectId}/tables/${params.table}/update`,
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.credential}`,
    }),
    body: (params) => ({
      data: params.data,
      filter: params.filter,
    }),
  },
  directExecution: async (params: SupabaseUpdateParams) => {
    try {
      // This is a mock implementation
      console.log(`Updating data in Supabase table ${params.table} in project ${params.projectId}`)
      console.log('Filter:', params.filter)
      console.log('Data to update:', params.data)

      // Mock response
      const mockData = [{ ...params.data, id: params.filter.value }]

      return {
        success: true,
        output: {
          message: `Successfully updated data in ${params.table}`,
          results: mockData,
        },
        data: mockData,
        error: null,
      }
    } catch (error) {
      console.error('Error updating Supabase data:', error)
      return {
        success: false,
        output: {
          message: `Error updating Supabase data: ${error instanceof Error ? error.message : String(error)}`,
        },
        data: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to update data in Supabase')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        message: 'Successfully updated data in Supabase',
        results: data,
      },
      severity: 'info',
      data: data,
      error: null,
    }
  },
  transformError: (error: any) => {
    return error.message || 'An error occurred while updating data in Supabase'
  },
}
