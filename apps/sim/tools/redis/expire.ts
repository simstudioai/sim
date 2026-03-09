import type { RedisExpireParams, RedisExpireResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisExpireTool: ToolConfig<RedisExpireParams, RedisExpireResponse> = {
  id: 'redis_expire',
  name: 'Redis EXPIRE',
  description: 'Set an expiration time (in seconds) on a key in Redis.',
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
      description: 'The key to set expiration on',
    },
    seconds: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'EXPIRE',
      args: [params.key, params.seconds],
    }),
  },

  transformResponse: async (response: Response, params?: RedisExpireParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set expiration in Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        result: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that expiration was set on' },
    result: {
      type: 'number',
      description: '1 if the timeout was set, 0 if the key does not exist',
    },
  },
}
