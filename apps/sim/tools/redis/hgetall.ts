import type { RedisHGetAllParams, RedisHGetAllResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisHGetAllTool: ToolConfig<RedisHGetAllParams, RedisHGetAllResponse> = {
  id: 'redis_hgetall',
  name: 'Redis HGETALL',
  description: 'Get all fields and values of a hash stored at a key in Redis.',
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
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'HGETALL',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisHGetAllParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get hash from Redis')
    }

    // ioredis .call() returns HGETALL as a flat array [field1, value1, field2, value2, ...]
    // We convert it to a key-value object for usability
    const raw = data.result
    let fields: Record<string, string> = {}

    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i += 2) {
        fields[raw[i]] = raw[i + 1] ?? ''
      }
    } else if (raw && typeof raw === 'object') {
      fields = raw
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        fields,
        fieldCount: Object.keys(fields).length,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The hash key' },
    fields: {
      type: 'object',
      description:
        'All field-value pairs in the hash as a key-value object. Empty object if the key does not exist.',
    },
    fieldCount: { type: 'number', description: 'Number of fields in the hash' },
  },
}
