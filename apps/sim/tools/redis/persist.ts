import type { RedisPersistParams, RedisPersistResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisPersistTool: ToolConfig<RedisPersistParams, RedisPersistResponse> = {
  id: 'redis_persist',
  name: 'Redis PERSIST',
  description: 'Remove the expiration from a key in Redis, making it persist indefinitely.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Redis connection URL (e.g. redis://user:password@host:port)',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The key to persist',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'PERSIST',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisPersistParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to persist key in Redis')
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
    key: { type: 'string', description: 'The key that was persisted' },
    result: {
      type: 'number',
      description:
        '1 if the expiration was removed, 0 if the key does not exist or has no expiration',
    },
  },
}
