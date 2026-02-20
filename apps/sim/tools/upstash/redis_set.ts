import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisSetParams, UpstashRedisSetResponse } from '@/tools/upstash/types'

export const upstashRedisSetTool: ToolConfig<UpstashRedisSetParams, UpstashRedisSetResponse> = {
  id: 'upstash_redis_set',
  name: 'Upstash Redis Set',
  description:
    'Set the value of a key in Upstash Redis with an optional expiration time in seconds.',
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
      description: 'The key to set',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value to store',
    },
    ex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expiration time in seconds (optional)',
    },
  },

  request: {
    url: (params) => {
      const base = `${params.restUrl}/set/${encodeURIComponent(params.key)}`
      if (params.ex) {
        return `${base}?EX=${params.ex}`
      }
      return base
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
      'Content-Type': 'text/plain',
    }),
    body: (params) => params.value,
  },

  transformResponse: async (response: Response, params?: UpstashRedisSetParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set key in Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        result: data.result ?? 'OK',
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was set' },
    result: { type: 'string', description: 'The result of the SET operation (typically "OK")' },
  },
}
