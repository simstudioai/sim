import type { RedisHSetParams, RedisHSetResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisHSetTool: ToolConfig<RedisHSetParams, RedisHSetResponse> = {
  id: 'redis_hset',
  name: 'Redis HSET',
  description: 'Set a field in a hash stored at a key in Redis.',
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
      description: 'The field name within the hash',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value to set for the field',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'HSET',
      args: [params.key, params.field, params.value],
    }),
  },

  transformResponse: async (response: Response, params?: RedisHSetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set hash field in Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        field: params?.field ?? '',
        result: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The hash key' },
    field: { type: 'string', description: 'The field that was set' },
    result: {
      type: 'number',
      description: 'Number of fields added (1 if new, 0 if updated)',
    },
  },
}
