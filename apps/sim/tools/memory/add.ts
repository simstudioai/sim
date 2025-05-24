import type { ToolConfig } from '../types'
import type { MemoryResponse } from './types'

export const memoryAddTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_add',
  name: 'Add Memory',
  description:
    'Add a new memory to the database or append to existing memory with the same ID. When appending to existing memory, the memory types must match.',
  version: '1.0.0',
  params: {
    id: {
      type: 'string',
      required: true,
      description:
        'Identifier for the memory. If a memory with this ID already exists, the new data will be appended to it.',
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
    },
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

      // Prepare error response instead of throwing error
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

      const body: Record<string, any> = {
        key: params.id,
        type: params.type,
        workflowId,
      }

      // Set data based on type
      if (params.type === 'agent') {
        if (!params.role || !params.content) {
          return {
            _errorResponse: {
              status: 400,
              data: {
                success: false,
                error: {
                  message: 'Role and content are required for agent memory',
                },
              },
            },
          }
        }
        body.data = {
          role: params.role,
          content: params.content,
        }
      } else if (params.type === 'raw') {
        if (!params.rawData) {
          return {
            _errorResponse: {
              status: 400,
              data: {
                success: false,
                error: {
                  message: 'Raw data is required for raw memory',
                },
              },
            },
          }
        }

        let parsedRawData
        if (typeof params.rawData === 'string') {
          try {
            parsedRawData = JSON.parse(params.rawData)
          } catch (_e) {
            return {
              _errorResponse: {
                status: 400,
                data: {
                  success: false,
                  error: {
                    message: 'Invalid JSON for raw data',
                  },
                },
              },
            }
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
      const errorMessage = result.error?.message || 'Failed to add memory'

      const data = result.data || result

      // Extract the memories from the response based on memory type
      let memories
      if (data.type === 'agent') {
        // For agent memories, return the full array of message objects
        memories = Array.isArray(data.data) ? data.data : [data.data]
      } else {
        // For raw memories, return the raw data object
        memories = data.data
      }

      return {
        success: true,
        output: {
          memories,
        },
        error: errorMessage,
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          memories: undefined,
        },
        error,
      }
    }
  },
  transformError: async (error): Promise<MemoryResponse> => {
    const errorMessage = `Memory operation failed: ${error.message || 'Unknown error occurred'}`
    return {
      success: false,
      output: {
        memories: undefined,
        message: `Memory operation failed: ${error.message || 'Unknown error occurred'}`,
      },
      error: errorMessage,
    }
  },
}
