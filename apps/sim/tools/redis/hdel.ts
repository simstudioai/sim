import type { RedisHDelParams, RedisHDelResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisHDelTool: ToolConfig<RedisHDelParams, RedisHDelResponse> = {
  id: 'redis_hdel',
  name: 'Redis HDEL',
  description: 'Delete a field from a hash stored at a key in Redis.',
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
      description: 'The hash key',
    },
    field: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The field name to delete',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'HDEL',
      args: [params.key, params.field],
    }),
  },

  transformResponse: async (response: Response, params?: RedisHDelParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete hash field from Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        field: params?.field ?? '',
        deleted: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The hash key' },
    field: { type: 'string', description: 'The field that was deleted' },
    deleted: {
      type: 'number',
      description: 'Number of fields removed (1 if deleted, 0 if field did not exist)',
    },
  },
}
