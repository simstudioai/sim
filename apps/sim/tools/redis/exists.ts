import type { RedisExistsParams, RedisExistsResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisExistsTool: ToolConfig<RedisExistsParams, RedisExistsResponse> = {
  id: 'redis_exists',
  name: 'Redis EXISTS',
  description: 'Check if a key exists in Redis.',
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
      description: 'The key to check',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      url: params.url,
      command: 'EXISTS',
      args: [params.key],
    }),
  },

  transformResponse: async (response: Response, params?: RedisExistsParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to check key existence in Redis')
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
