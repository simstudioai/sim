import type { RedisTtlParams, RedisTtlResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisTtlTool: ToolConfig<RedisTtlParams, RedisTtlResponse> = {
  id: 'redis_ttl',
  name: 'Redis TTL',
  description: 'Get the remaining time to live (in seconds) of a key in Redis.',
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
      description: 'The key to check TTL for',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'TTL',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisTtlParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get TTL from Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        ttl: data.result ?? -2,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was checked' },
    ttl: {
      type: 'number',
      description:
        'Remaining TTL in seconds. Positive integer if TTL set, -1 if no expiration, -2 if key does not exist.',
    },
  },
}
