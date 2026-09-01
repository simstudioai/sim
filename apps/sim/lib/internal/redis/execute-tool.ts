import { getErrorMessage } from '@sim/utils/errors'
import { executeRedisCommand, RedisOperationInputError } from '@/lib/internal/redis/operations'
import { type RedisExecuteInput, redisExecuteInputSchema } from '@/lib/internal/redis/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const REDIS_TOOL_IDS = new Set([
  'redis_command',
  'redis_delete',
  'redis_exists',
  'redis_expire',
  'redis_get',
  'redis_hdel',
  'redis_hget',
  'redis_hgetall',
  'redis_hset',
  'redis_incr',
  'redis_incrby',
  'redis_keys',
  'redis_llen',
  'redis_lpop',
  'redis_lpush',
  'redis_lrange',
  'redis_persist',
  'redis_rpop',
  'redis_rpush',
  'redis_set',
  'redis_setnx',
  'redis_ttl',
])

function parseRedisInput(
  input: unknown
): { success: true; data: RedisExecuteInput } | { success: false; response: Response } {
  const parsed = redisExecuteInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      response: Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      ),
    }
  }
  return { success: true, data: parsed.data }
}

export const executeRedisTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()
  if (!REDIS_TOOL_IDS.has(toolId)) {
    return Response.json({ error: `Unsupported Redis tool: ${toolId}` }, { status: 500 })
  }

  const parsed = parseRedisInput(input)
  if (!parsed.success) return parsed.response

  try {
    const result = await executeRedisCommand(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof RedisOperationInputError) {
      return Response.json({ error: error.responseError }, { status: 400 })
    }
    return Response.json({ error: getErrorMessage(error, 'Redis command failed') }, { status: 500 })
  }
}
