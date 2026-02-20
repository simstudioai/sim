import type { RedisDeleteParams, RedisDeleteResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisDeleteTool: ToolConfig<RedisDeleteParams, RedisDeleteResponse> = {
  id: 'redis_delete',
  name: 'Redis Delete',
  description: 'Delete a key from Redis.',
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
      description: 'The key to delete',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'DEL',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisDeleteParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete key from Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        deletedCount: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was deleted' },
    deletedCount: {
      type: 'number',
      description: 'Number of keys deleted (0 if key did not exist, 1 if deleted)',
    },
  },
}
