import type { SupabaseInsertParams, SupabaseInsertResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const insertTool: ToolConfig<SupabaseInsertParams, SupabaseInsertResponse> = {
  id: 'supabase_insert',
  name: 'Supabase Insert',
  description: 'Insert data into a Supabase table',
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
      visibility: 'hidden',
      description: 'Your Supabase service role secret key',
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
      // Prepare the data - if it's an object but not an array, wrap it in an array
      const dataToSend =
        typeof params.data === 'object' && !Array.isArray(params.data) ? [params.data] : params.data

      return dataToSend
    },
  },

  transformResponse: async (response: Response) => {
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

    let data
    try {
      data = JSON.parse(text)
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase response: ${parseError}`)
    }

    // Check if results array is empty and provide better feedback
    const resultsArray = Array.isArray(data) ? data : [data]
    const isEmpty = resultsArray.length === 0 || (resultsArray.length === 1 && !resultsArray[0])

    if (isEmpty) {
      return {
        success: false,
        output: {
          message: 'No data was inserted into Supabase',
          results: data,
        },
        error:
          'No data was inserted into Supabase. This usually indicates invalid data format or schema mismatch. Please check that your JSON is valid and matches your table schema.',
      }
    }

    const insertedCount = resultsArray.length
    return {
      success: true,
      output: {
        message: `Successfully inserted ${insertedCount} row${insertedCount === 1 ? '' : 's'} into Supabase`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of inserted records' },
  },
}
