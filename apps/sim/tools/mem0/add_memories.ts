import { ADD_MEMORY_OUTPUT_PROPERTIES } from '@/tools/mem0/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Add Memories Tool
 * @see https://docs.mem0.ai/api-reference/memory/add-memories
 */
export const mem0AddMemoriesTool: ToolConfig = {
  id: 'mem0_add_memories',
  name: 'Add Memories',
  description: 'Add memories to Mem0 for persistent storage and retrieval',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID associated with the memory (e.g., "user_123", "alice@example.com")',
    },
    messages: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of message objects with role and content (e.g., [{"role": "user", "content": "Hello"}])',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Mem0 API key',
    },
  },

  request: {
    url: 'https://api.mem0.ai/v1/memories/',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Token ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // First, ensure messages is an array
      let messagesArray = params.messages
      if (typeof messagesArray === 'string') {
        try {
          messagesArray = JSON.parse(messagesArray)
        } catch (_e) {
          throw new Error('Messages must be a valid JSON array of objects with role and content')
        }
      }

      // Validate message format
      if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
        throw new Error('Messages must be a non-empty array')
      }

      for (const msg of messagesArray) {
        if (!msg.role || !msg.content) {
          throw new Error('Each message must have role and content properties')
        }
      }

      // Prepare request body
      const body: Record<string, any> = {
        messages: messagesArray,
        version: 'v2',
        user_id: params.userId,
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    // If the API returns an empty array, this might be normal behavior on success
    if (Array.isArray(data) && data.length === 0) {
      return {
        success: true,
        output: {
          memories: [],
        },
      }
    }

    // Handle array response with memory objects
    if (Array.isArray(data) && data.length > 0) {
      // Extract IDs for easy access
      const memoryIds = data.map((memory) => memory.id)

      return {
        success: true,
        output: {
          ids: memoryIds,
          memories: data,
        },
      }
    }

    // Handle non-array responses (single memory object)
    if (data && !Array.isArray(data) && data.id) {
      return {
        success: true,
        output: {
          ids: [data.id],
          memories: [data],
        },
      }
    }

    // Default response format if none of the above match
    return {
      success: true,
      output: {
        memories: Array.isArray(data) ? data : [data],
      },
    }
  },

  outputs: {
    ids: {
      type: 'array',
      description: 'Array of memory IDs that were created',
      items: {
        type: 'string',
      },
    },
    memories: {
      type: 'array',
      description: 'Array of memory objects that were created',
      items: {
        type: 'object',
        properties: ADD_MEMORY_OUTPUT_PROPERTIES,
      },
    },
  },
}
