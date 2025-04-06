import { ToolConfig } from '../types'
import { SupabaseInsertParams, SupabaseInsertResponse } from './types'

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
    apiKey: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    table: { type: 'string', required: true },
    data: { type: 'any', required: true },
  },
  request: {
    url: (params) =>
      `https://${params.projectId}.supabase.co/rest/v1/${params.table}`,
    method: 'POST',
    headers: (params) => ({
      'apikey': params.apiKey,
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // If data is an object but not an array, wrap it in an array
      if (typeof params.data === 'object' && !Array.isArray(params.data)) {
        return [params.data];
      }
      // If it's already an array, return as is
      return params.data;
    },
  },
  directExecution: async (params: SupabaseInsertParams) => {
    try {
      // Construct the URL for the Supabase REST API
      const url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}`;
      
      // Prepare the data - if it's an object but not an array, wrap it in an array
      const dataToSend = typeof params.data === 'object' && !Array.isArray(params.data)
        ? [params.data]
        : params.data;
      
      // Insert the data
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': params.apiKey,
          'Authorization': `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error from Supabase: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();

      return {
        success: true,
        output: {
          message: `Successfully inserted data into ${params.table}`,
          results: data,
        },
        data: data,
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
      const error = await response.json();
      throw new Error(error.message || 'Failed to insert data into Supabase');
    }

    const data = await response.json();

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
