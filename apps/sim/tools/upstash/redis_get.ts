import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisGetParams, UpstashRedisGetResponse } from '@/tools/upstash/types'

export const upstashRedisGetTool: ToolConfig<UpstashRedisGetParams, UpstashRedisGetResponse> = {
  id: 'upstash_redis_get',
  name: 'Upstash Redis Get',
  description: 'Get the value of a key from Upstash Redis.',
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
      description: 'The key to retrieve',
    },
  },

  request: {
    url: (params) => `${params.restUrl}/get/${encodeURIComponent(params.key)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisGetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get key from Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        value: data.result ?? null,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was retrieved' },
    value: { type: 'json', description: 'The value of the key (string), or null if not found' },
  },
}
