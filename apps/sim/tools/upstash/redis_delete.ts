import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisDeleteParams, UpstashRedisDeleteResponse } from '@/tools/upstash/types'

export const upstashRedisDeleteTool: ToolConfig<
  UpstashRedisDeleteParams,
  UpstashRedisDeleteResponse
> = {
  id: 'upstash_redis_delete',
  name: 'Upstash Redis Delete',
  description: 'Delete a key from Upstash Redis.',
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
      description: 'The key to delete',
    },
  },

  request: {
    url: (params) => `${params.restUrl}/del/${encodeURIComponent(params.key)}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: UpstashRedisDeleteParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete key from Upstash Redis')
    }

    return {
      success: true,
      output: {
        key: params?.key ?? '',
        deletedCount: data.result ?? 0,
      },
    }
  },

  outputs: {
    key: { type: 'string', description: 'The key that was deleted' },
    deletedCount: {
      type: 'number',
      description: 'Number of keys deleted (0 if key did not exist, 1 if deleted)',
    },
  },
}
