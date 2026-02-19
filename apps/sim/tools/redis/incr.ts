import type { RedisIncrParams, RedisIncrResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisIncrTool: ToolConfig<RedisIncrParams, RedisIncrResponse> = {
  id: 'redis_incr',
  name: 'Redis INCR',
  description: 'Increment the integer value of a key by one in Redis.',
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
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'INCR',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisIncrParams) => {
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
