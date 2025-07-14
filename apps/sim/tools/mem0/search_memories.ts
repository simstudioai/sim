import type { ToolConfig } from '../types'
import type { Mem0Response } from './types'

// Search Memories Tool
export const mem0SearchMemoriesTool: ToolConfig<any, Mem0Response> = {
  id: 'mem0_search_memories',
  name: 'Search Memories',
  description: 'Search for memories in Mem0 using semantic search',
  version: '1.0.0',
  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'User ID to search memories for',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to find relevant memories',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-only',
      description: 'Maximum number of results to return',
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
        top_k: params.limit || 10,
      }

      return body
    },
  },
  transformResponse: async (response) => {
    try {
      // Get raw response for debugging
      const responseText = await response.clone().text()

      // Parse the response
      const data = JSON.parse(responseText)

      // Handle empty results
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return {
          success: true,
          output: {
            searchResults: [],
            ids: [],
          },
        }
      }

      // For array results (standard format)
      if (Array.isArray(data)) {
        const searchResults = data.map((item) => ({
          id: item.id,
          data: { memory: item.memory || '' },
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

      // Fallback for unexpected response format
      return {
        success: true,
        output: {
          searchResults: [],
        },
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          error: `Failed to process search response: ${error.message}`,
        },
      }
    }
  },
  transformError: async (error) => {
    return {
      success: false,
      output: {
        ids: [],
        searchResults: [],
      },
    }
  },
}
