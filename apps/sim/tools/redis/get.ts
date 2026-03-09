import type { RedisGetParams, RedisGetResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisGetTool: ToolConfig<RedisGetParams, RedisGetResponse> = {
  id: 'redis_get',
  name: 'Redis Get',
  description: 'Get the value of a key from Redis.',
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
      description: 'The key to retrieve',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'GET',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisGetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get key from Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        value: data.result ?? null,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was retrieved' },
    value: {
      type: 'string',
      description: 'The value of the key, or null if the key does not exist',
      optional: true,
    },
  },
}
