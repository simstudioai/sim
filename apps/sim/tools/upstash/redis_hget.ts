import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisHGetParams, UpstashRedisHGetResponse } from '@/tools/upstash/types'

export const upstashRedisHGetTool: ToolConfig<UpstashRedisHGetParams, UpstashRedisHGetResponse> = {
  id: 'upstash_redis_hget',
  name: 'Upstash Redis HGET',
  description: 'Get the value of a field in a hash stored at a key in Upstash Redis.',
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
      description: 'The hash key',
    },
    field: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The field name to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${params.restUrl}/hget/${encodeURIComponent(params.key)}/${encodeURIComponent(params.field)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisHGetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to HGET from Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        field: params?.field ?? '',
        value: data.result ?? null,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The hash key' },
    field: { type: 'string', description: 'The field that was retrieved' },
    value: {
      type: 'json',
      description: 'The value of the hash field (string), or null if not found',
    },
  },
}
