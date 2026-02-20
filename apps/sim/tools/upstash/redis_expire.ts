import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisExpireParams, UpstashRedisExpireResponse } from '@/tools/upstash/types'

export const upstashRedisExpireTool: ToolConfig<
  UpstashRedisExpireParams,
  UpstashRedisExpireResponse
> = {
  id: 'upstash_redis_expire',
  name: 'Upstash Redis EXPIRE',
  description: 'Set a timeout on a key in Upstash Redis. After the timeout, the key is deleted.',
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
      description: 'The key to set expiration on',
    },
    seconds: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds',
    },
  },

  request: {
    url: (params) => `${params.restUrl}/expire/${encodeURIComponent(params.key)}/${params.seconds}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisExpireParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to EXPIRE in Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        result: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that expiration was set on' },
    result: {
      type: 'number',
      description: '1 if the timeout was set, 0 if the key does not exist',
    },
  },
}
