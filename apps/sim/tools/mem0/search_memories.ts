import type { Mem0Response } from '@/tools/mem0/types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/mem0/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Search Memories Tool
 * @see https://docs.mem0.ai/api-reference/memory/search-memories
 */
export const mem0SearchMemoriesTool: ToolConfig<any, Mem0Response> = {
  id: 'mem0_search_memories',
  name: 'Search Memories',
  description: 'Search for memories in Mem0 using semantic search',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to search memories for (e.g., "user_123", "alice@example.com")',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to find relevant memories (e.g., "What are my favorite foods?")',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10, 50, 100)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Mem0 API key',
    },
  },

  request: {
    url: 'https://api.mem0.ai/v2/memories/search/',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Token ${params.apiKey}`,
    }),
    body: (params) => {
      // Create the request body with the format that the curl test confirms works
      const body: Record<string, any> = {
        query: params.query || 'test',
        filters: {
          user_id: params.userId,
        },
        top_k: Number(params.limit || 10),
      }

      return body
    },
  },

  transformResponse: async (response): Promise<Mem0Response> => {
    const data = await response.json()

    if (!data || (Array.isArray(data) && data.length === 0)) {
      return {
        success: true,
        output: {
          searchResults: [],
          ids: [],
        },
      }
    }

    if (Array.isArray(data)) {
      const searchResults = data.map((item) => ({
        id: item.id,
        memory: item.memory || '',
        user_id: item.user_id,
        agent_id: item.agent_id,
        app_id: item.app_id,
        run_id: item.run_id,
        hash: item.hash,
        metadata: item.metadata,
        categories: item.categories,
        created_at: item.created_at,
        updated_at: item.updated_at,
        score: item.score || 0,
      }))

      const ids = data.map((item) => item.id).filter(Boolean)

      return {
        success: true,
        output: {
          searchResults,
          ids,
        },
      }
    }

    return {
      success: true,
      output: {
        searchResults: [],
        ids: [],
      },
    }
  },

  outputs: {
    searchResults: {
      type: 'array',
      description: 'Array of search results with memory data and similarity scores',
      items: {
        type: 'object',
        properties: SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
    ids: {
      type: 'array',
      description: 'Array of memory IDs found in the search results',
      items: {
        type: 'string',
      },
    },
  },
}
