import { buildMemoryKey } from '@/tools/memory/helpers'
import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryAddTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_add',
  name: 'Add Memory',
  description: 'Add a new memory to the database or append to existing memory with the same ID.',
  version: '1.0.0',

  params: {
    conversationId: {
      type: 'string',
      required: false,
      description:
        'Conversation identifier (e.g., user-123, session-abc). If a memory with this conversationId already exists, the new message will be appended to it.',
    },
    id: {
      type: 'string',
      required: false,
      description:
        'Legacy parameter for conversation identifier. Use conversationId instead. Provided for backwards compatibility.',
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

  request: {
    url: '/api/memory',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
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

      if (!conversationId || conversationId.trim() === '') {
        return {
          _errorResponse: {
            status: 400,
            data: {
              success: false,
              error: {
                message: 'conversationId or id is required',
              },
            },
          },
        }
      }

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

      const key = buildMemoryKey(conversationId)

      const body: Record<string, any> = {
        key,
        workspaceId,
        data: {
          role: params.role,
          content: params.content,
        },
      }

      return body
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
