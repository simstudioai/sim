import type { MemoryIdentifierParams, MemoryResponse } from '@/tools/memory/types'
import type { InternalToolConfig } from '@/tools/types'

export const memoryDeleteTool: InternalToolConfig<MemoryIdentifierParams, MemoryResponse> = {
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

  operation: {
    input: (params) => {
      const conversationId = params.conversationId || params.id
      if (!conversationId) throw new Error('conversationId or id is required')
      return { conversationId }
    },
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
