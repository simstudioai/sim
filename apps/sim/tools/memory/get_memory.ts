import { ToolConfig } from '../types'
import { MemoryResponse } from './types'

// Get Memory Tool
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
        throw new Error(result.error?.message || 'Failed to retrieve memory')
      }
      
      const data = result.data || result
      
      return {
        success: true,
        output: {
          memory: data,
          id: data.id,
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