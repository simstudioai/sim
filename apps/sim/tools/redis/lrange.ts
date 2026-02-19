import type { RedisLRangeParams, RedisLRangeResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisLRangeTool: ToolConfig<RedisLRangeParams, RedisLRangeResponse> = {
  id: 'redis_lrange',
  name: 'Redis LRANGE',
  description: 'Get a range of elements from a list stored at a key in Redis.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Redis connection URL (e.g. redis://user:password@host:port)',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list key',
    },
    start: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start index (0-based)',
    },
    stop: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stop index (-1 for all elements)',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'LRANGE',
      args: [params.key, params.start, params.stop],
    }),
  },

  transformResponse: async (response: Response, params?: RedisLRangeParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get list range from Redis')
    }

    const values = data.result ?? []

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        values,
        count: values.length,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The list key' },
    values: {
      type: 'array',
      description: 'List elements in the specified range',
      items: { type: 'string', description: 'A list element' },
    },
    count: { type: 'number', description: 'Number of elements returned' },
  },
}
