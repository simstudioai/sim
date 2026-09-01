import type { MemoryAddParams, MemoryResponse } from '@/tools/memory/types'
import type { InternalToolConfig } from '@/tools/types'

export const memoryAddTool: InternalToolConfig<MemoryAddParams, MemoryResponse> = {
  id: 'memory_add',
  name: 'Add Memory',
  description: 'Add a new memory to the database or append to existing memory with the same ID.',
  version: '1.0.0',

  params: {
    conversationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Conversation identifier (e.g., user-123, session-abc). If a memory with this conversationId already exists, the new message will be appended to it.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Legacy parameter for conversation identifier. Use conversationId instead. Provided for backwards compatibility.',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Role for agent memory (user, assistant, or system)',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content for agent memory',
    },
  },

  operation: {
    input: (params) => {
      const conversationId = params.conversationId || params.id
      if (!conversationId) throw new Error('conversationId or id is required')
      return {
        key: conversationId,
        data: { role: params.role, content: params.content },
      }
    },
    secretProvenance: {
      request: () => [{ key: 'data', inputPaths: [['role'], ['content']] }],
      response: { incomplete: 'reject' },
    },
  },

  transformResponse: async (response): Promise<MemoryResponse> => {
    const result = await response.json()
    const data = result.data || result

    const memories = Array.isArray(data.data) ? data.data : [data.data]

    return {
      success: true,
      output: {
        memories,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the memory was added successfully' },
    memories: {
      type: 'array',
      description: 'Array of memory objects including the new or updated memory',
    },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
