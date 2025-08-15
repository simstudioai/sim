import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

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
  },
  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        message: 'Memory deleted successfully.',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the memory was deleted successfully' },
    message: { type: 'string', description: 'Success or error message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
