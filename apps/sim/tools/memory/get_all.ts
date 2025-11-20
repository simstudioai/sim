import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryGetAllTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get_all',
  name: 'Get All Memories',
  description: 'Retrieve all memories from the database',
  version: '1.0.0',

  params: {},

  request: {
    url: (params): any => {
      const workflowId = params._context?.workflowId

      if (!workflowId) {
        return {
          _errorResponse: {
            status: 400,
            data: {
              success: false,
              error: {
                message: 'workflowId is required and must be provided in execution context',
              },
            },
          },
        }
      }

      return `/api/memory?workflowId=${encodeURIComponent(workflowId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()

    const data = result.data || result
    const memories = data.memories || data || []

    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        success: true,
        output: {
          memories: [],
          message: 'No memories found',
        },
      }
    }

    return {
      success: true,
      output: {
        memories,
        message: `Found ${memories.length} memories`,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether all memories were retrieved successfully' },
    memories: {
      type: 'array',
      description:
        'Array of all memory objects with key, conversationId, blockId, blockName, and data fields',
    },
    message: { type: 'string', description: 'Success or error message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
