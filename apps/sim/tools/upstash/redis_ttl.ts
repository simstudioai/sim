import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisTtlParams, UpstashRedisTtlResponse } from '@/tools/upstash/types'

export const upstashRedisTtlTool: ToolConfig<UpstashRedisTtlParams, UpstashRedisTtlResponse> = {
  id: 'upstash_redis_ttl',
  name: 'Upstash Redis TTL',
  description:
    'Get the remaining time to live of a key in Upstash Redis. Returns -1 if the key has no expiration, -2 if the key does not exist.',
  version: '1.0.0',

  params: {
    restUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Upstash Redis REST URL',
    },
    restToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Upstash Redis REST Token',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The key to check TTL for',
    },
  },

  request: {
    url: (params) => `${params.restUrl}/ttl/${encodeURIComponent(params.key)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisTtlParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get TTL from Upstash Redis')
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
    key: { type: 'string', description: 'The key checked' },
    ttl: {
      type: 'number',
      description:
        'Remaining TTL in seconds. Positive integer if the key has a TTL set, -1 if the key exists with no expiration, -2 if the key does not exist.',
    },
  },
}
