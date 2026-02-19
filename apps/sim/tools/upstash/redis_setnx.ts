import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisSetnxParams, UpstashRedisSetnxResponse } from '@/tools/upstash/types'

export const upstashRedisSetnxTool: ToolConfig<UpstashRedisSetnxParams, UpstashRedisSetnxResponse> =
  {
    id: 'upstash_redis_setnx',
    name: 'Upstash Redis SETNX',
    description:
      'Set the value of a key only if it does not already exist. Returns true if the key was set, false if it already existed.',
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
        description: 'The value to store if the key does not exist',
      },
    },

    request: {
      url: (params) => `${params.restUrl}/setnx/${encodeURIComponent(params.key)}`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.restToken}`,
        'Content-Type': 'text/plain',
      }),
      body: (params) => params.value,
    },

    transformResponse: async (response: Response, params?: UpstashRedisSetnxParams) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to SETNX in Upstash Redis')
      }

      return {
        success: true,
        output: {
          key: params?.key ?? '',
          wasSet: data.result === 1,
        },
      }
    },

    outputs: {
      key: { type: 'string', description: 'The key that was attempted to set' },
      wasSet: {
        type: 'boolean',
        description: 'Whether the key was set (true) or already existed (false)',
      },
    },
  }
