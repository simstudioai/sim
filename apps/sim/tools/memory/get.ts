import type { MemoryIdentifierParams, MemoryResponse } from '@/tools/memory/types'
import type { InternalToolConfig } from '@/tools/types'

export const memoryGetTool: InternalToolConfig<MemoryIdentifierParams, MemoryResponse> = {
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

  operation: {
    input: (params) => {
      const conversationId = params.conversationId || params.id
      if (!conversationId) throw new Error('conversationId or id is required')
      return { id: conversationId }
    },
    secretProvenance: { response: { incomplete: 'reject' } },
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
