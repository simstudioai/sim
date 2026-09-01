import { isRecordLike } from '@sim/utils/object'
import { getRedisClient } from '@/lib/core/config/redis'

const SESSION_TTL_SECONDS = 24 * 60 * 60

export interface SlackStreamSessionTarget {
  channel: string
  threadTs: string
}

export interface SlackStreamSessionExecution {
  executionId: string
  workflowId: string
  userId: string
  workspaceId: string
}

function getSessionKey(credentialId: string, target: SlackStreamSessionTarget): string {
  return `slack:agent-session:${credentialId}:${target.channel}:${target.threadTs}`
}

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis is required for Slack agent session streaming')
  }
  return redis
}

function parseExecution(value: string): SlackStreamSessionExecution {
  const parsed = JSON.parse(value) as unknown
  if (
    !isRecordLike(parsed) ||
    typeof parsed.executionId !== 'string' ||
    typeof parsed.workflowId !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.workspaceId !== 'string'
  ) {
    throw new Error('Invalid Slack agent session execution record')
  }
  return {
    executionId: parsed.executionId,
    workflowId: parsed.workflowId,
    userId: parsed.userId,
    workspaceId: parsed.workspaceId,
  }
}

export async function registerSlackStreamSession(
  credentialId: string,
  target: SlackStreamSessionTarget,
  execution: SlackStreamSessionExecution
): Promise<void> {
  const redis = requireRedis()
  const key = getSessionKey(credentialId, target)
  await redis
    .multi()
    .hset(key, execution.executionId, JSON.stringify(execution))
    .expire(key, SESSION_TTL_SECONDS)
    .exec()
}

export async function unregisterSlackStreamSession(
  credentialId: string,
  target: SlackStreamSessionTarget,
  executionId: string
): Promise<void> {
  const redis = requireRedis()
  const key = getSessionKey(credentialId, target)
  await redis.eval(
    `
redis.call('HDEL', KEYS[1], ARGV[1])
if redis.call('HLEN', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return 1
`,
    1,
    key,
    executionId
  )
}

export async function listSlackStreamSessions(
  credentialId: string,
  target: SlackStreamSessionTarget
): Promise<SlackStreamSessionExecution[]> {
  const redis = requireRedis()
  const values = await redis.hvals(getSessionKey(credentialId, target))
  if (!Array.isArray(values)) {
    throw new Error('Invalid Redis response for Slack agent session lookup')
  }
  return values.map((value) => {
    if (typeof value !== 'string') {
      throw new Error('Invalid Slack agent session value in Redis')
    }
    return parseExecution(value)
  })
}

export function resolveStoppedSlackSession(body: unknown): SlackStreamSessionTarget | null {
  if (!isRecordLike(body) || !isRecordLike(body.event)) return null
  if (body.event.type !== 'agent_session_stopped') return null
  if (typeof body.event.channel !== 'string' || !body.event.channel) {
    throw new Error('Slack agent_session_stopped event is missing channel')
  }
  if (typeof body.event.thread_ts !== 'string' || !body.event.thread_ts) {
    throw new Error('Slack agent_session_stopped event is missing thread_ts')
  }
  return { channel: body.event.channel, threadTs: body.event.thread_ts }
}
