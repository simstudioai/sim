import type { RedisSetParams, RedisSetResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisSetTool: ToolConfig<RedisSetParams, RedisSetResponse> = {
  id: 'redis_set',
  name: 'Redis Set',
  description: 'Set the value of a key in Redis with an optional expiration time in seconds.',
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
      description: 'The key to set',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value to store',
    },
    ex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expiration time in seconds (optional)',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'SET',
      args: params.ex ? [params.key, params.value, 'EX', params.ex] : [params.key, params.value],
    }),
  },

  transformResponse: async (response: Response, params?: RedisSetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set key in Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        result: data.result ?? 'OK',
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was set' },
    result: { type: 'string', description: 'The result of the SET operation (typically "OK")' },
  },
}
