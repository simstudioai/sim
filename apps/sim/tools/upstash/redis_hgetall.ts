import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisHGetAllParams, UpstashRedisHGetAllResponse } from '@/tools/upstash/types'

export const upstashRedisHGetAllTool: ToolConfig<
  UpstashRedisHGetAllParams,
  UpstashRedisHGetAllResponse
> = {
  id: 'upstash_redis_hgetall',
  name: 'Upstash Redis HGETALL',
  description: 'Get all fields and values of a hash stored at a key in Upstash Redis.',
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
  },

  request: {
    url: (params) => `${params.restUrl}/hgetall/${encodeURIComponent(params.key)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisHGetAllParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to HGETALL from Upstash Redis')
    }

    const result = data.result ?? []
    const fields: Record<string, string> = {}
    for (let i = 0; i < result.length; i += 2) {
      fields[result[i]] = result[i + 1] ?? null
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
      description: 'All field-value pairs in the hash, keyed by field name',
    },
    fieldCount: { type: 'number', description: 'Number of fields in the hash' },
  },
}
