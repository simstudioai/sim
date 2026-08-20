import type { ToolConfig } from '../types'
import type { MemoryResponse } from './types'

export const memoryGetTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get',
  name: 'Get Memory',
  description: 'Retrieve a specific memory by its ID',
  version: '1.0.0',
  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Identifier for the memory to retrieve',
    },
  },
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
      return `/api/memory/${encodeURIComponent(params.id)}?workflowId=${encodeURIComponent(workflowId)}`
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
        const errorMessage = result.error?.message || 'Failed to retrieve memory'
        throw new Error(errorMessage)
      }

      const data = result.data || result

      return {
        success: true,
        output: {
          memories: data.data,
          message: 'Memory retrieved successfully',
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          memories: undefined,
          message: `Failed to retrieve memory: ${error.message || 'Unknown error'}`,
        },
        error: `Failed to retrieve memory: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<MemoryResponse> => {
    const errorMessage = `Memory retrieval failed: ${error.message || 'Unknown error'}`
    return {
      success: false,
      output: {
        memories: undefined,
        message: errorMessage,
      },
      error: errorMessage,
    }
  },
}
