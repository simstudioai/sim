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
      visibility: 'user-or-llm',
      description:
        'Conversation identifier (e.g., user-123, session-abc). Returns memories for this conversation.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Legacy parameter for conversation identifier. Use conversationId instead. Provided for backwards compatibility.',
    },
  },

  request: {
    url: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }

      const conversationId = params.conversationId || params.id
      if (!conversationId) {
        throw new Error('conversationId or id is required')
      }
      const url = new URL(`/api/memory/${encodeURIComponent(conversationId)}`, 'http://dummy')
      url.searchParams.set('workspaceId', workspaceId)

      return url.pathname + url.search
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()
    const memory = result.data

    if (!memory) {
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
        memories: [memory],
        message: 'Found 1 memory',
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
