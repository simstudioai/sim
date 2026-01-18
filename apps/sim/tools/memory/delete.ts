import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryDeleteTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_delete',
  name: 'Delete Memory',
  description: 'Delete memories by conversationId.',
  version: '1.0.0',

  params: {
    conversationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Conversation identifier (e.g., user-123, session-abc). Deletes all memories for this conversation.',
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

      const url = new URL('/api/memory', 'http://dummy')
      url.searchParams.set('workspaceId', workspaceId)
      url.searchParams.set('conversationId', conversationId)

      return url.pathname + url.search
    },
    method: 'DELETE',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()
    const data = result.data || result

    return {
      success: result.success !== false,
      output: {
        message: data.message || 'Memories deleted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the memory was deleted successfully' },
    message: { type: 'string', description: 'Success or error message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
