import type { RedisKeysParams, RedisKeysResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisKeysTool: ToolConfig<RedisKeysParams, RedisKeysResponse> = {
  id: 'redis_keys',
  name: 'Redis Keys',
  description:
    'List all keys matching a pattern in Redis. Avoid using on large databases in production; use the Redis Command tool with SCAN for large key spaces.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Redis connection URL (e.g. redis://user:password@host:port)',
    },
    pattern: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pattern to match keys (default: * for all keys)',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'KEYS',
      args: [params.pattern || '*'],
    }),
  },

  transformResponse: async (response: Response, params?: RedisKeysParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list keys from Redis')
    }

    const keys = data.result ?? []

    return {
      success: true,
      output: {
        pattern: params?.pattern || '*',
        keys,
        count: keys.length,
      },
    }
  },

  outputs: {
    pattern: { type: 'string', description: 'The pattern used to match keys' },
    keys: {
      type: 'array',
      description: 'List of keys matching the pattern',
      items: { type: 'string', description: 'A Redis key' },
    },
    count: { type: 'number', description: 'Number of keys found' },
  },
}
