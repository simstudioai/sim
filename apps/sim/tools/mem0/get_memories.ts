import { MEMORY_OUTPUT_PROPERTIES, type Mem0GetMemoriesParams } from '@/tools/mem0/types'
import { isRecord } from '@/tools/mem0/utils'
import type { ToolConfig } from '@/tools/types'

const getMemoriesFromResponse = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data
  if (!isRecord(data)) return []
  if (Array.isArray(data.results)) return data.results
  if (isRecord(data.memory)) return [data.memory]
  if (data.id) return [data]
  return []
}

const getMemoryId = (memory: unknown): string | undefined =>
  isRecord(memory) && typeof memory.id === 'string' ? memory.id : undefined

/**
 * Get Memories Tool
 * @see https://docs.mem0.ai/api-reference/memory/get-memories
 */
export const mem0GetMemoriesTool: ToolConfig<Mem0GetMemoriesParams> = {
  id: 'mem0_get_memories',
  name: 'Get Memories',
  description: 'Retrieve memories from Mem0 by ID or filter criteria',
  version: '1.0.0',

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to retrieve memories for (e.g., "user_123", "alice@example.com")',
    },
    memoryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific memory ID to retrieve (e.g., "mem_abc123")',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date for filtering by created_at (e.g., "2024-01-15")',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date for filtering by created_at (e.g., "2024-12-31")',
    },
    limit: {
      type: 'number',
      required: false,
      default: 10,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (e.g., 10, 50, 100)',
    },
    page: {
      type: 'number',
      required: false,
      default: 1,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve for paginated list results',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Mem0 API key',
    },
  },

  request: {
    url: (params) => {
      const memoryId = typeof params.memoryId === 'string' ? params.memoryId.trim() : undefined
      if (memoryId) {
        return `https://api.mem0.ai/v1/memories/${encodeURIComponent(memoryId)}/`
      }
      return 'https://api.mem0.ai/v3/memories/'
    },
    method: (params) =>
      typeof params.memoryId === 'string' && params.memoryId.trim() ? 'GET' : 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Token ${params.apiKey}`,
    }),
    body: (params) => {
      if (typeof params.memoryId === 'string' && params.memoryId.trim()) {
        return undefined
      }

      const filters: Record<string, unknown> = {
        user_id: params.userId?.trim(),
      }
      if (params.startDate || params.endDate) {
        const dateFilter: Record<string, unknown> = {}
        if (params.startDate) {
          dateFilter.gte = params.startDate
        }
        if (params.endDate) {
          dateFilter.lte = params.endDate
        }
        filters.created_at = dateFilter
      }

      return {
        filters,
        page: Number(params.page ?? 1),
        page_size: Number(params.limit || 10),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const memories = getMemoriesFromResponse(data)
    const ids = memories.map(getMemoryId).filter((id): id is string => Boolean(id))

    return {
      success: true,
      output: {
        memories,
        ids,
        ...(isRecord(data) && typeof data.count === 'number' ? { count: data.count } : {}),
        ...(isRecord(data) && (typeof data.next === 'string' || data.next === null)
          ? { next: data.next }
          : {}),
        ...(isRecord(data) && (typeof data.previous === 'string' || data.previous === null)
          ? { previous: data.previous }
          : {}),
      },
    }
  },

  outputs: {
    memories: {
      type: 'array',
      description: 'Array of retrieved memory objects',
      items: {
        type: 'object',
        properties: MEMORY_OUTPUT_PROPERTIES,
      },
    },
    ids: {
      type: 'array',
      description: 'Array of memory IDs that were retrieved',
      items: {
        type: 'string',
      },
    },
    count: {
      type: 'number',
      description: 'Total number of memories matching the filters',
      optional: true,
    },
    next: {
      type: 'string',
      description: 'URL for the next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL for the previous page of results',
      optional: true,
    },
  },
}
