import type { RedisSetnxParams, RedisSetnxResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisSetnxTool: ToolConfig<RedisSetnxParams, RedisSetnxResponse> = {
  id: 'redis_setnx',
  name: 'Redis SETNX',
  description: 'Set the value of a key in Redis only if the key does not already exist.',
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
      description: 'The key to set',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The value to store',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'SETNX',
      args: [params.key, params.value],
    }),
  },

  transformResponse: async (response: Response, params?: RedisSetnxParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to set key in Redis')
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
    key: { type: 'string', description: 'The key that was set' },
    wasSet: {
      type: 'boolean',
      description: 'Whether the key was set (true) or already existed (false)',
    },
  },
}
