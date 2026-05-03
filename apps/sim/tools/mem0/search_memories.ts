import type { Mem0Response, Mem0SearchMemoriesParams } from '@/tools/mem0/types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/mem0/types'
import { isRecord, type JsonRecord } from '@/tools/mem0/utils'
import type { ToolConfig } from '@/tools/types'

const getSearchResults = (data: unknown): JsonRecord[] => {
  if (!isRecord(data) || !Array.isArray(data.results)) return []
  return data.results.filter(isRecord)
}

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const getStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined

const getNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : fallback

/**
 * Search Memories Tool
 * @see https://docs.mem0.ai/api-reference/memory/search-memories
 */
export const mem0SearchMemoriesTool: ToolConfig<Mem0SearchMemoriesParams, Mem0Response> = {
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
    url: 'https://api.mem0.ai/v3/memories/search/',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Token ${params.apiKey}`,
    }),
    body: (params) => {
      return {
        query: params.query,
        filters: {
          user_id: params.userId.trim(),
        },
        top_k: Number(params.limit || 10),
      }
    },
  },

  transformResponse: async (response): Promise<Mem0Response> => {
    const data = await response.json()
    const searchResults = getSearchResults(data).map((result) => ({
      id: getString(result.id) ?? '',
      memory: getString(result.memory) ?? '',
      user_id: getString(result.user_id),
      agent_id: getString(result.agent_id),
      app_id: getString(result.app_id),
      run_id: getString(result.run_id),
      hash: getString(result.hash),
      metadata: isRecord(result.metadata) ? result.metadata : undefined,
      categories: getStringArray(result.categories),
      created_at: getString(result.created_at),
      updated_at: getString(result.updated_at),
      score: getNumber(result.score),
    }))
    const ids = searchResults.map((result) => result.id).filter(Boolean)

    return {
      success: true,
      output: {
        searchResults,
        ids,
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
