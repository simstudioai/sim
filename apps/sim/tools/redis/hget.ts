import type { RedisHGetParams, RedisHGetResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisHGetTool: ToolConfig<RedisHGetParams, RedisHGetResponse> = {
  id: 'redis_hget',
  name: 'Redis HGET',
  description: 'Get the value of a field in a hash stored at a key in Redis.',
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
      description: 'The field name to retrieve',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'HGET',
      args: [params.key, params.field],
    }),
  },

  transformResponse: async (response: Response, params?: RedisHGetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get hash field from Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        field: params?.field ?? '',
        value: data.result ?? null,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The hash key' },
    field: { type: 'string', description: 'The field that was retrieved' },
    value: {
      type: 'string',
      description: 'The field value, or null if the field or key does not exist',
      optional: true,
    },
  },
}
