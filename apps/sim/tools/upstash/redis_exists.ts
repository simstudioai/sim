import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisExistsParams, UpstashRedisExistsResponse } from '@/tools/upstash/types'

export const upstashRedisExistsTool: ToolConfig<
  UpstashRedisExistsParams,
  UpstashRedisExistsResponse
> = {
  id: 'upstash_redis_exists',
  name: 'Upstash Redis EXISTS',
  description:
    'Check if a key exists in Upstash Redis. Returns true if the key exists, false otherwise.',
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
      description: 'The key to check',
    },
  },

  request: {
    url: (params) => `${params.restUrl}/exists/${encodeURIComponent(params.key)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisExistsParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to check key existence in Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        exists: data.result === 1,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was checked' },
    exists: { type: 'boolean', description: 'Whether the key exists (true) or not (false)' },
  },
}
