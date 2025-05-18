import { ToolConfig } from '../types'
import { MemoryResponse } from './types'

// Delete Memory Tool
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
    }
  },
  request: {
    url: (params) => {
      // Get workflowId from context (set by workflow execution)
      const workflowId = params._context?.workflowId
      
      if (!workflowId) {
        throw new Error('workflowId is required and must be provided in execution context')
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
        throw new Error(result.error?.message || 'Failed to delete memory')
      }
      
      return {
        success: true,
        output: {
          // Return empty memory since it was deleted
          memory: undefined,
          id: undefined,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          memory: undefined,
        },
      }
    }
  },
  transformError: async (error): Promise<MemoryResponse> => {
    return {
      success: false,
      output: {
        memory: undefined,
      },
    }
  },
} 