import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisIncrParams, UpstashRedisIncrResponse } from '@/tools/upstash/types'

export const upstashRedisIncrTool: ToolConfig<UpstashRedisIncrParams, UpstashRedisIncrResponse> = {
  id: 'upstash_redis_incr',
  name: 'Upstash Redis INCR',
  description:
    'Atomically increment the integer value of a key by one in Upstash Redis. If the key does not exist, it is set to 0 before incrementing.',
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
      description: 'The key to increment',
    },
  },

  request: {
    url: (params) => `${params.restUrl}/incr/${encodeURIComponent(params.key)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisIncrParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to INCR in Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        value: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was incremented' },
    value: { type: 'number', description: 'The new value after incrementing' },
  },
}
