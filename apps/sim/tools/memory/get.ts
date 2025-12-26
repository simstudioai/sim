import { buildMemoryKey } from '@/tools/memory/helpers'
import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryGetTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get',
  name: 'Get Memory',
  description: 'Retrieve memory by conversationId. Returns matching memories.',
  version: '1.0.0',

  params: {
    conversationId: {
      type: 'string',
      required: false,
      description:
        'Conversation identifier (e.g., user-123, session-abc). Returns memories for this conversation.',
    },
    id: {
      type: 'string',
      required: false,
      description:
        'Legacy parameter for conversation identifier. Use conversationId instead. Provided for backwards compatibility.',
    },
  },

  request: {
    url: (params): any => {
      const workspaceId = params._context?.workspaceId

      if (!workspaceId) {
        return {
          _errorResponse: {
            status: 400,
            data: {
              success: false,
              error: {
                message: 'workspaceId is required and must be provided in execution context',
              },
            },
          },
        }
      }

      const conversationId = params.conversationId || params.id

      if (!conversationId) {
        return {
          _errorResponse: {
            status: 400,
            data: {
              success: false,
              error: {
                message: 'conversationId or id must be provided',
              },
            },
          },
        }
      }

      const query = buildMemoryKey(conversationId)

      const url = new URL('/api/memory', 'http://dummy')
      url.searchParams.set('workspaceId', workspaceId)
      url.searchParams.set('query', query)
      url.searchParams.set('limit', '1000')

      return url.pathname + url.search
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()
    const memories = result.data?.memories || []

    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        success: true,
        output: {
          memories: [],
          message: 'No memories found',
        },
      }
    }

    return {
      success: true,
      output: {
        memories,
        message: `Found ${memories.length} memories`,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the memory was retrieved successfully' },
    memories: {
      type: 'array',
      description: 'Array of memory objects with conversationId and data fields',
    },
    message: { type: 'string', description: 'Success or error message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
