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
      // Get workflowId from context (set by workflow execution)
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

      // Append workflowId as query parameter
      return `/api/memory?workflowId=${encodeURIComponent(workflowId)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()

    // Extract memories from the response
    const data = result.data || result
    const rawMemories = data.memories || data || []

    // Transform memories to return them with their keys and types for better context
    const memories = rawMemories.map((memory: any) => ({
      key: memory.key,
      type: memory.type,
      data: memory.data,
    }))

    return {
      success: true,
      output: {
        memories,
        message: 'Memories retrieved successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether all memories were retrieved successfully' },
    memories: {
      type: 'array',
      description: 'Array of all memory objects with keys, types, and data',
    },
    message: { type: 'string', description: 'Success or error message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
