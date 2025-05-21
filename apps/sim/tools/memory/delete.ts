import { ToolConfig } from '../types'
import { MemoryResponse } from './types'

export const memoryDeleteTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_delete',
  name: 'Delete Memory',
  description: 'Delete a specific memory by its ID',
  version: '1.0.0',
  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Identifier for the memory to delete',
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
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<MemoryResponse> => {
    try {
      const result = await response.json()

      if (!response.ok) {
        const errorMessage = result.error?.message || 'Failed to delete memory'
        throw new Error(errorMessage)
      }

      return {
        success: true,
        output: {
          message: `Memory deleted successfully.`,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          message: `Failed to delete memory: ${error.message || 'Unknown error'}`,
        },
        error: `Failed to delete memory: ${error.message || 'Unknown error'}`,
      }
    }
  },
  transformError: async (error): Promise<MemoryResponse> => {
    const errorMessage = `Memory deletion failed: ${error.message || 'Unknown error'}`
    return {
      success: false,
      output: {
        message: errorMessage,
      },
      error: errorMessage,
    }
  },
}
