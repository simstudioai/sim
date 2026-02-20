import type { RedisIncrbyParams, RedisIncrbyResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisIncrbyTool: ToolConfig<RedisIncrbyParams, RedisIncrbyResponse> = {
  id: 'redis_incrby',
  name: 'Redis INCRBY',
  description: 'Increment the integer value of a key by a given amount in Redis.',
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
      description: 'The key to increment',
    },
    increment: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount to increment by (negative to decrement)',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'INCRBY',
      args: [params.key, params.increment],
    }),
  },

  transformResponse: async (response: Response, params?: RedisIncrbyParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to increment key in Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        value: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was incremented' },
    value: { type: 'number', description: 'The new value after increment' },
  },
}
