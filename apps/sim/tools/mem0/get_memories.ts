import { MEMORY_OUTPUT_PROPERTIES } from '@/tools/mem0/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Get Memories Tool
 * @see https://docs.mem0.ai/api-reference/memory/get-memories
 */
export const mem0GetMemoriesTool: ToolConfig = {
  id: 'mem0_get_memories',
  name: 'Get Memories',
  description: 'Retrieve memories from Mem0 by ID or filter criteria',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to retrieve memories for (e.g., "user_123", "alice@example.com")',
    },
    memoryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific memory ID to retrieve (e.g., "mem_abc123")',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date for filtering by created_at (e.g., "2024-01-15")',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date for filtering by created_at (e.g., "2024-12-31")',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10, 50, 100)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Mem0 API key',
    },
  },

  request: {
    url: (params: Record<string, any>) => {
      // For a specific memory ID, use the get single memory endpoint
      if (params.memoryId) {
        // Dynamically set method to GET for memory ID requests
        params.method = 'GET'
        return `https://api.mem0.ai/v1/memories/${params.memoryId}/`
      }
      // Otherwise use v2 memories endpoint with filters
      return 'https://api.mem0.ai/v2/memories/'
    },
    method: 'POST', // Default to POST for filtering
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Token ${params.apiKey}`,
    }),
    body: (params: Record<string, any>) => {
      // For specific memory ID, we'll use GET method instead and don't need a body
      // But we still need to return an empty object to satisfy the type
      if (params.memoryId) {
        return {}
      }

      // Build filters array for AND condition
      const andConditions = []

      // Add user filter
      andConditions.push({ user_id: params.userId })

      // Add date range filter if provided
      if (params.startDate || params.endDate) {
        const dateFilter: Record<string, any> = {}

        if (params.startDate) {
          dateFilter.gte = params.startDate
        }

        if (params.endDate) {
          dateFilter.lte = params.endDate
        }

        andConditions.push({ created_at: dateFilter })
      }

      // Build final filters object
      const body: Record<string, any> = {
        page_size: Number(params.limit || 10),
      }

      // Only add filters if we have any conditions
      if (andConditions.length > 0) {
        body.filters = { AND: andConditions }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const memories = Array.isArray(data) ? data : [data]
    const ids = memories.map((memory) => memory.id).filter(Boolean)

    return {
      success: true,
      output: {
        memories,
        ids,
      },
    }
  },

  outputs: {
    memories: {
      type: 'array',
      description: 'Array of retrieved memory objects',
      items: {
        type: 'object',
        properties: MEMORY_OUTPUT_PROPERTIES,
      },
    },
    ids: {
      type: 'array',
      description: 'Array of memory IDs that were retrieved',
      items: {
        type: 'string',
      },
    },
  },
}
