import type { InsForgeInsertParams, InsForgeInsertResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const insertTool: ToolConfig<InsForgeInsertParams, InsForgeInsertResponse> = {
  id: 'insforge_insert',
  name: 'InsForge Insert',
  description: 'Insert data into an InsForge database table',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the table to insert data into',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'The data to insert (array of objects or a single object)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/api/database/records/${encodeURIComponent(params.table)}?select=*`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: (params) => {
      const dataToSend =
        typeof params.data === 'object' && !Array.isArray(params.data) ? [params.data] : params.data
      return dataToSend
    },
  },

  transformResponse: async (response: Response) => {
    const text = await response.text()
    let data

    if (text?.trim()) {
      try {
        data = JSON.parse(text)
      } catch (parseError) {
        throw new Error(`Failed to parse InsForge response: ${parseError}`)
      }
    } else {
      data = []
    }

    const insertedCount = Array.isArray(data) ? data.length : 0

    if (insertedCount === 0) {
      return {
        success: true,
        output: {
          message: 'No rows were inserted',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully inserted ${insertedCount} row${insertedCount === 1 ? '' : 's'} into InsForge`,
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
