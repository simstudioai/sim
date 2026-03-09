import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'
import { PAGINATION_OUTPUT_PROPERTIES, THREADS_ARRAY_OUTPUT } from '@/tools/zep/types'

export const zepGetUserThreadsTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_user_threads',
  name: 'Get User Threads',
  description: 'List all conversation threads for a specific user',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to get threads for (e.g., "user_123")',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-or-llm',
      description: 'Maximum number of threads to return (e.g., 10, 25, 50)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: (params) => {
      const limit = Number(params.limit || 10)
      return `https://api.getzep.com/api/v2/users/${params.userId}/threads?limit=${limit}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const data = await response.json()
    const threads = data.threads || data || []

    return {
      success: true,
      output: {
        threads,
        totalCount: threads.length,
      },
    }
  },

  outputs: {
    threads: THREADS_ARRAY_OUTPUT,
    totalCount: PAGINATION_OUTPUT_PROPERTIES.totalCount,
  },
}
