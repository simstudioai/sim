import { ToolConfig } from '../types'
import { MemoryResponse } from './types'

// Add Memory Tool
export const memoryAddTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_add',
  name: 'Add Memory',
  description: 'Add a new memory to the database',
  version: '1.0.0',
  params: {
    id: {
      type: 'string',
      required: true,
      description: 'Identifier for the memory',
    },
    type: {
      type: 'string',
      required: true,
      description: 'Type of memory (agent or raw)',
    },
    role: {
      type: 'string',
      required: false,
      description: 'Role for agent memory (user, assistant, or system)',
    },
    content: {
      type: 'string',
      required: false,
      description: 'Content for agent memory',
    },
    rawData: {
      type: 'json',
      required: false,
      description: 'Raw data to store (JSON format)',
    }
  },
  request: {
    url: '/api/memory',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Get workflowId from context (set by workflow execution)
      const workflowId = params._context?.workflowId
      
      if (!workflowId) {
        throw new Error('workflowId is required and must be provided in execution context')
      }
      
      const body: Record<string, any> = {
        key: params.id,
        type: params.type,
        workflowId
      }

      // Set data based on type
      if (params.type === 'agent') {
        if (!params.role || !params.content) {
          throw new Error('Role and content are required for agent memory')
        }
        body.data = {
          role: params.role,
          content: params.content,
        }
      } else if (params.type === 'raw') {
        if (!params.rawData) {
          throw new Error('Raw data is required for raw memory')
        }
        
        let parsedRawData
        if (typeof params.rawData === 'string') {
          try {
            parsedRawData = JSON.parse(params.rawData)
          } catch (e) {
            throw new Error('Invalid JSON for raw data')
          }
        } else {
          parsedRawData = params.rawData
        }
        
        body.data = parsedRawData
      }

      return body
    },
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<MemoryResponse> => {
    try {
      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error?.message || 'Failed to add memory')
      }
      
      const data = result.data || result
      
      return {
        success: true,
        output: {
          id: data.id,
          memory: data,
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