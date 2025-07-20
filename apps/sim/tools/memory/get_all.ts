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
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<MemoryResponse> => {
    try {
      const result = await response.json()

      if (!response.ok) {
        const errorMessage = result.error?.message || 'Failed to retrieve memories'
        throw new Error(errorMessage)
      }

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
    } catch (error: any) {
      return {
        success: false,
        output: {
          memories: [],
          message: `Failed to retrieve memories: ${error.message || 'Unknown error'}`,
        },
        error: `Failed to retrieve memories: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<MemoryResponse> => {
    const errorMessage = `Memory retrieval failed: ${error.message || 'Unknown error'}`
    return {
      success: false,
      output: {
        memories: [],
        message: errorMessage,
      },
      error: errorMessage,
    }
  },
}
