import type { RedisLLenParams, RedisLLenResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisLLenTool: ToolConfig<RedisLLenParams, RedisLLenResponse> = {
  id: 'redis_llen',
  name: 'Redis LLEN',
  description: 'Get the length of a list stored at a key in Redis.',
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
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'LLEN',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisLLenParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get list length from Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        length: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The list key' },
    length: {
      type: 'number',
      description: 'The length of the list, or 0 if the key does not exist',
    },
  },
}
