import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Get User Threads Tool - List all threads for a user (Zep v3)
export const zepGetUserThreadsTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_user_threads',
  name: 'Get User Threads',
  description: 'List all conversation threads for a specific user',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'User ID to get threads for',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-only',
      description: 'Maximum number of threads to return',
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
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Zep API error (${response.status}): ${text || response.statusText}`)
    }

    const data = JSON.parse(text.replace(/^\uFEFF/, '').trim())

    return {
      success: true,
      output: {
        threads: data.threads || data || [],
        userId: data.user_id,
      },
    }
  },

  outputs: {
    threads: {
      type: 'array',
      description: 'Array of thread objects for this user',
    },
    userId: {
      type: 'string',
      description: 'The user ID',
    },
  },
}
