import type { SupabaseUpsertParams, SupabaseUpsertResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const upsertTool: ToolConfig<SupabaseUpsertParams, SupabaseUpsertResponse> = {
  id: 'supabase_upsert',
  name: 'Supabase Upsert',
  description: 'Insert or update data in a Supabase table (upsert operation)',
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
      description: 'The name of the Supabase table to upsert data into',
    },
    data: {
      type: 'any',
      required: true,
      visibility: 'user-or-llm',
      description: 'The data to upsert (insert or update)',
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
      Prefer: 'return=representation,resolution=merge-duplicates',
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
          message: 'Successfully upserted data into Supabase (no data returned)',
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
          message: 'No data was upserted into Supabase',
          results: data,
        },
        error:
          'No data was upserted into Supabase. This usually indicates invalid data format or schema mismatch. Please check that your JSON is valid and matches your table schema.',
      }
    }

    const upsertedCount = resultsArray.length
    return {
      success: true,
      output: {
        message: `Successfully upserted ${upsertedCount} row${upsertedCount === 1 ? '' : 's'} into Supabase`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of upserted records' },
  },
}
