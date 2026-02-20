import type { RedisRPopParams, RedisRPopResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisRPopTool: ToolConfig<RedisRPopParams, RedisRPopResponse> = {
  id: 'redis_rpop',
  name: 'Redis RPOP',
  description: 'Remove and return the last element of a list stored at a key in Redis.',
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
      command: 'RPOP',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisRPopParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to pop from list in Redis')
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
    key: { type: 'string', description: 'The list key' },
    value: {
      type: 'string',
      description: 'The removed element, or null if the list is empty',
      optional: true,
    },
  },
}
