import type { RedisCommandParams, RedisCommandResponse } from '@/tools/redis/types'
import type { ToolConfig } from '@/tools/types'

export const redisCommandTool: ToolConfig<RedisCommandParams, RedisCommandResponse> = {
  id: 'redis_command',
  name: 'Redis Command',
  description:
    'Execute a raw Redis command as a JSON array (e.g. ["HSET", "key", "field", "value"]).',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Redis connection URL (e.g. redis://user:password@host:port)',
    },
    command: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Redis command as a JSON array (e.g. ["SET", "key", "value"])',
    },
  },

  request: {
    url: '/api/tools/redis/execute',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(params.command)
      } catch {
        throw new Error(
          `Invalid JSON in command: ${params.command}. Expected a JSON array like ["SET", "key", "value"].`
        )
      }
      const [cmd, ...args] = Array.isArray(parsed) ? parsed : [parsed]
      return {
        url: params.url,
        command: String(cmd),
        args: args.map(String),
      }
    },
  },

  transformResponse: async (response: Response, params?: RedisCommandParams) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to execute Redis command')
    }

    return {
      success: true,
      output: {
        command: params?.command ?? '',
        result: data.result ?? null,
      },
    }
  },

  outputs: {
    command: { type: 'string', description: 'The command that was executed' },
    result: { type: 'json', description: 'The result of the command' },
  },
}
