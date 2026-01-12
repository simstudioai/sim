import type { InsForgeUpdateParams, InsForgeUpdateResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<InsForgeUpdateParams, InsForgeUpdateResponse> = {
  id: 'insforge_update',
  name: 'InsForge Update',
  description: 'Update rows in an InsForge database table based on filter criteria',
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
      description: 'The name of the table to update',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostgREST filter to identify rows to update (e.g., "id=eq.123")',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data to update in the matching rows',
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
      let url = `${base}/api/database/records/${encodeURIComponent(params.table)}?select=*`

      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      return url
    },
    method: 'PATCH',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: (params) => params.data,
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

    const updatedCount = Array.isArray(data) ? data.length : 0

    if (updatedCount === 0) {
      return {
        success: true,
        output: {
          message: 'No rows were updated (no matching records found)',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully updated ${updatedCount} row${updatedCount === 1 ? '' : 's'} in InsForge`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of updated records' },
  },
}
