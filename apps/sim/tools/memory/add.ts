import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryAddTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_add',
  name: 'Add Memory',
  description: 'Add a new memory to the database or append to existing memory with the same ID.',
  version: '1.0.0',
  params: {
    id: {
      type: 'string',
      required: true,
      description:
        'Identifier for the memory. If a memory with this ID already exists, the new data will be appended to it.',
    },
    role: {
      type: 'string',
      required: true,
      description: 'Role for agent memory (user, assistant, or system)',
    },
    content: {
      type: 'string',
      required: true,
      description: 'Content for agent memory',
    },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the memory was added successfully' },
    memories: {
      type: 'array',
      description: 'Array of memory objects including the new or updated memory',
    },
    error: { type: 'string', description: 'Error message if operation failed' },
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
        type: 'agent', // Always agent type
        workflowId,
      }

      // Validate and set data
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

      return body
    },
    isInternalRoute: true,
  },
  transformResponse: async (response): Promise<MemoryResponse> => {
    try {
      const result = await response.json()
      const errorMessage = result.error?.message || 'Failed to add memory'

      const data = result.data || result

      // For agent memories, return the full array of message objects
      const memories = Array.isArray(data.data) ? data.data : [data.data]

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
