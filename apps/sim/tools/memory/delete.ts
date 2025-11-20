import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryDeleteTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_delete',
  name: 'Delete Memory',
  description:
    'Delete memories by conversationId, blockId, blockName, or a combination. Supports bulk deletion.',
  version: '1.0.0',

  params: {
    conversationId: {
      type: 'string',
      required: false,
      description:
        'Conversation identifier (e.g., user-123, session-abc). If provided alone, deletes all memories for this conversation across all blocks.',
    },
    id: {
      type: 'string',
      required: false,
      description:
        'Legacy parameter for conversation identifier. Use conversationId instead. Provided for backwards compatibility.',
    },
    blockId: {
      type: 'string',
      required: false,
      description:
        'Block identifier. If provided alone, deletes all memories for this block across all conversations. If provided with conversationId, deletes memories for that specific conversation in this block.',
    },
    blockName: {
      type: 'string',
      required: false,
      description:
        'Block name. Alternative to blockId. If provided alone, deletes all memories for blocks with this name. If provided with conversationId, deletes memories for that conversation in blocks with this name.',
    },
  },

  request: {
    url: (params): any => {
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

      // Use 'id' as fallback for 'conversationId' for backwards compatibility
      const conversationId = params.conversationId || params.id

      if (!conversationId && !params.blockId && !params.blockName) {
        return {
          _errorResponse: {
            status: 400,
            data: {
              success: false,
              error: {
                message:
                  'At least one of conversationId, id, blockId, or blockName must be provided',
              },
            },
          },
        }
      }

      const url = new URL('/api/memory', 'http://dummy')
      url.searchParams.set('workflowId', workflowId)

      if (conversationId) {
        url.searchParams.set('conversationId', conversationId)
      }
      if (params.blockId) {
        url.searchParams.set('blockId', params.blockId)
      }
      if (params.blockName) {
        url.searchParams.set('blockName', params.blockName)
      }

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
