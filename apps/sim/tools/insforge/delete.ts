import type { InsForgeDeleteParams, InsForgeDeleteResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<InsForgeDeleteParams, InsForgeDeleteResponse> = {
  id: 'insforge_delete',
  name: 'InsForge Delete',
  description: 'Delete rows from an InsForge database table based on filter criteria',
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
      description: 'The name of the table to delete from',
    },
    filter: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostgREST filter to identify rows to delete (e.g., "id=eq.123")',
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
      let url = `${base}/api/database/records/${params.table}?select=*`

      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      } else {
        throw new Error(
          'Filter is required for delete operations to prevent accidental deletion of all rows'
        )
      }

      return url
    },
    method: 'DELETE',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      Prefer: 'return=representation',
    }),
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

    const deletedCount = Array.isArray(data) ? data.length : 0

    if (deletedCount === 0) {
      return {
        success: true,
        output: {
          message: 'No rows were deleted (no matching records found)',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully deleted ${deletedCount} row${deletedCount === 1 ? '' : 's'} from InsForge`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of deleted records' },
  },
}
