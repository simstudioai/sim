import type { RedisRPushParams, RedisRPushResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisRPushTool: ToolConfig<RedisRPushParams, RedisRPushResponse> = {
  id: 'redis_rpush',
  name: 'Redis RPUSH',
  description: 'Append a value to the end of a list stored at a key in Redis.',
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
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value to append',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'RPUSH',
      args: [params.key, params.value],
    }),
  },

  transformResponse: async (response: Response, params?: RedisRPushParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to push to list in Redis')
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
    length: { type: 'number', description: 'Length of the list after the push' },
  },
}
