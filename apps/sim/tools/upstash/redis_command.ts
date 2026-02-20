import type { ToolConfig } from '@/tools/types'
import type { UpstashRedisCommandParams, UpstashRedisCommandResponse } from '@/tools/upstash/types'

export const upstashRedisCommandTool: ToolConfig<
  UpstashRedisCommandParams,
  UpstashRedisCommandResponse
> = {
  id: 'upstash_redis_command',
  name: 'Upstash Redis Command',
  description:
    'Execute an arbitrary Redis command against Upstash Redis. Pass the full command as a JSON array (e.g., ["HSET", "myhash", "field1", "value1"]).',
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
    command: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Redis command as a JSON array (e.g., ["HSET", "myhash", "field1", "value1"]) or a simple command string (e.g., "PING")',
    },
  },

  request: {
    url: (params) => params.restUrl,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.restToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      try {
        const parsed = JSON.parse(params.command)
        if (Array.isArray(parsed)) {
          return parsed
        }
        return [String(parsed)]
      } catch {
        return params.command.trim().split(/\s+/)
      }
    },
  },

  transformResponse: async (response: Response, params?: UpstashRedisCommandParams) => {
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
    result: { type: 'json', description: 'The result of the Redis command' },
  },
}
