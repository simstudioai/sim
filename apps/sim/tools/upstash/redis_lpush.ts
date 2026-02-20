import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisLPushParams, UpstashRedisLPushResponse } from '@/tools/upstash/types'

export const upstashRedisLPushTool: ToolConfig<UpstashRedisLPushParams, UpstashRedisLPushResponse> =
  {
    id: 'upstash_redis_lpush',
    name: 'Upstash Redis LPUSH',
    description:
      'Prepend a value to the beginning of a list in Upstash Redis. Creates the list if it does not exist.',
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
      value: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The value to prepend to the list',
      },
    },

    request: {
      url: (params) => `${params.restUrl}/lpush/${encodeURIComponent(params.key)}`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.restToken}`,
        'Content-Type': 'text/plain',
      }),
      body: (params) => params.value,
    },

    transformResponse: async (response: Response, params?: UpstashRedisLPushParams) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to LPUSH in Upstash Redis')
      }

      return {
        success: true,
        output: {
          key: params?.key ?? '',
          length: data.result ?? 0,
        },
      }
    },

    outputs: {
      key: { type: 'string', description: 'The list key' },
      length: { type: 'number', description: 'The length of the list after the push' },
    },
  }
