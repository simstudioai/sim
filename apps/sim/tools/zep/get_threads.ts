import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Get Threads Tool - List all threads (Zep v3)
export const zepGetThreadsTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_threads',
  name: 'Get Threads',
  description: 'List all conversation threads',
  version: '1.0.0',

  params: {
    pageSize: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-only',
      description: 'Number of threads to retrieve per page',
    },
    pageNumber: {
      type: 'number',
      required: false,
      default: 1,
      visibility: 'user-only',
      description: 'Page number for pagination',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Field to order results by (created_at, updated_at, user_id, thread_id)',
    },
    asc: {
      type: 'boolean',
      required: false,
      default: false,
      visibility: 'user-only',
      description: 'Order direction: true for ascending, false for descending',
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
      const queryParams = new URLSearchParams()
      queryParams.append('page_size', String(Number(params.pageSize || 10)))
      queryParams.append('page_number', String(Number(params.pageNumber || 1)))
      if (params.orderBy) queryParams.append('order_by', params.orderBy)
      if (params.asc !== undefined) queryParams.append('asc', String(params.asc))
      return `https://api.getzep.com/api/v2/threads?${queryParams.toString()}`
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
        threads: data.threads || [],
        responseCount: data.response_count,
        totalCount: data.total_count,
      },
    }
  },

  outputs: {
    threads: {
      type: 'array',
      description: 'Array of thread objects',
    },
    responseCount: {
      type: 'number',
      description: 'Number of threads in this response',
    },
    totalCount: {
      type: 'number',
      description: 'Total number of threads available',
    },
  },
}
