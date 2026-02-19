import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisHSetParams, UpstashRedisHSetResponse } from '@/tools/upstash/types'

export const upstashRedisHSetTool: ToolConfig<UpstashRedisHSetParams, UpstashRedisHSetResponse> = {
  id: 'upstash_redis_hset',
  name: 'Upstash Redis HSET',
  description: 'Set a field in a hash stored at a key in Upstash Redis.',
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
      description: 'The field name within the hash',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value to store in the hash field',
    },
  },

  request: {
    url: (params) =>
      `${params.restUrl}/hset/${encodeURIComponent(params.key)}/${encodeURIComponent(params.field)}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
      'Content-Type': 'text/plain',
    }),
    body: (params) => params.value,
  },

  transformResponse: async (response: Response, params?: UpstashRedisHSetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to HSET in Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        field: params?.field ?? '',
        result: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The hash key' },
    field: { type: 'string', description: 'The field that was set' },
    result: {
      type: 'number',
      description: 'Number of new fields added (0 if field was updated, 1 if new)',
    },
  },
}
