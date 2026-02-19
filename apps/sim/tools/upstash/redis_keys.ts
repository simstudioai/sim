import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisKeysParams, UpstashRedisKeysResponse } from '@/tools/upstash/types'

export const upstashRedisKeysTool: ToolConfig<UpstashRedisKeysParams, UpstashRedisKeysResponse> = {
  id: 'upstash_redis_keys',
  name: 'Upstash Redis Keys',
  description: 'List keys matching a pattern in Upstash Redis. Defaults to listing all keys (*).',
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
    pattern: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pattern to match keys (e.g., "user:*"). Defaults to "*" for all keys.',
    },
  },

  request: {
    url: (params) => {
      const pattern = params.pattern || '*'
      return `${params.restUrl}/keys/${encodeURIComponent(pattern)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisKeysParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list keys from Upstash Redis')
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
