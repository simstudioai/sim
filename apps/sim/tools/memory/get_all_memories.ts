import { ToolConfig } from '../types'
import { MemoryResponse } from './types'

// Get All Memories Tool
export const memoryGetAllTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get_all',
  name: 'Get All Memories',
  description: 'Retrieve all memories from the database',
  version: '1.0.0',
  params: {},
  request: {
    url: (params) => {
      // Get workflowId from context (set by workflow execution)
      const workflowId = params._context?.workflowId
      
      if (!workflowId) {
        throw new Error('workflowId is required and must be provided in execution context')
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
        throw new Error(result.error?.message || 'Failed to retrieve memories')
      }
      
      // Extract memories from the response
      const data = result.data || result
      const memories = data.memories || data || []
      
      return {
        success: true,
        output: {
          memories,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          memories: [],
        },
      }
    }
  },
  transformError: async (error): Promise<MemoryResponse> => {
    return {
      success: false,
      output: {
        memories: [],
      },
    }
  },
} 