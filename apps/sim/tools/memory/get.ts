import { buildMemoryKey } from '@/tools/memory/helpers'
import type { MemoryResponse } from '@/tools/memory/types'
import type { ToolConfig } from '@/tools/types'

export const memoryGetTool: ToolConfig<any, MemoryResponse> = {
  id: 'memory_get',
  name: 'Get Memory',
  description:
    'Retrieve memory by conversationId, blockId, blockName, or a combination. Returns all matching memories.',
  version: '1.0.0',

  params: {
    conversationId: {
      type: 'string',
      required: false,
      description:
        'Conversation identifier (e.g., user-123, session-abc). If provided alone, returns all memories for this conversation across all blocks.',
    },
    blockId: {
      type: 'string',
      required: false,
      description:
        'Block identifier. If provided alone, returns all memories for this block across all conversations. If provided with conversationId, returns memories for that specific conversation in this block.',
    },
    blockName: {
      type: 'string',
      required: false,
      description:
        'Block name. Alternative to blockId. If provided alone, returns all memories for blocks with this name. If provided with conversationId, returns memories for that conversation in blocks with this name.',
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

      if (!params.conversationId && !params.blockId && !params.blockName) {
        return {
          _errorResponse: {
            status: 400,
            data: {
              success: false,
              error: {
                message: 'At least one of conversationId, blockId, or blockName must be provided',
              },
            },
          },
        }
      }

      let query = ''

      if (params.conversationId && params.blockId) {
        query = buildMemoryKey(params.conversationId, params.blockId)
      } else if (params.conversationId) {
        query = `${params.conversationId}:`
      } else if (params.blockId) {
        query = `:${params.blockId}`
      }

      const url = new URL('/api/memory', 'http://dummy')
      url.searchParams.set('workflowId', workflowId)
      if (query) {
        url.searchParams.set('query', query)
      }
      if (params.blockName) {
        url.searchParams.set('blockName', params.blockName)
      }
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
      description:
        'Array of memory objects with conversationId, blockId, blockName, and data fields',
    },
    message: { type: 'string', description: 'Success or error message' },
    error: { type: 'string', description: 'Error message if operation failed' },
  },
}
