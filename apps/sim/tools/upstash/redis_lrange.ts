import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisLRangeParams, UpstashRedisLRangeResponse } from '@/tools/upstash/types'

export const upstashRedisLRangeTool: ToolConfig<
  UpstashRedisLRangeParams,
  UpstashRedisLRangeResponse
> = {
  id: 'upstash_redis_lrange',
  name: 'Upstash Redis LRANGE',
  description:
    'Get a range of elements from a list in Upstash Redis. Use 0 and -1 for start and stop to get all elements.',
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
      description: 'The list key',
    },
    start: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start index (0-based, negative values count from end)',
    },
    stop: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stop index (inclusive, -1 for last element)',
    },
  },

  request: {
    url: (params) =>
      `${params.restUrl}/lrange/${encodeURIComponent(params.key)}/${params.start}/${params.stop}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisLRangeParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to LRANGE from Upstash Redis')
    }

    const values = data.result ?? []

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        values,
        count: values.length,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The list key' },
    values: {
      type: 'array',
      description: 'List of elements in the specified range',
      items: { type: 'string', description: 'A list element' },
    },
    count: { type: 'number', description: 'Number of elements returned' },
  },
}
