import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisIncrbyParams, UpstashRedisIncrbyResponse } from '@/tools/upstash/types'

export const upstashRedisIncrbyTool: ToolConfig<
  UpstashRedisIncrbyParams,
  UpstashRedisIncrbyResponse
> = {
  id: 'upstash_redis_incrby',
  name: 'Upstash Redis INCRBY',
  description:
    'Increment the integer value of a key by a given amount. Use a negative value to decrement. If the key does not exist, it is set to 0 before the operation.',
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
    increment: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Amount to increment by (use negative value to decrement)',
    },
  },

  request: {
    url: (params) =>
      `${params.restUrl}/incrby/${encodeURIComponent(params.key)}/${params.increment}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisIncrbyParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to INCRBY in Upstash Redis')
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
