import type { SessionPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const TTL_SECONDS = 600
const attemptSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  sharedApp: z.object({ id: z.string().min(1), revision: z.string().min(1) }).optional(),
  memberApp: z.object({ appId: z.string().min(1), teamId: z.string().min(1) }).optional(),
  clientId: z.string().min(1),
  encryptedClientSecret: z.string().min(1),
  encryptedSigningSecret: z.string().min(1),
  redirectUri: z.string().url(),
  createdAt: z.number(),
  installation: z
    .object({
      id: z.string(),
      revision: z.string(),
      credentialId: z.string(),
      appId: z.string(),
      teamId: z.string(),
      appRevision: z.string().optional(),
    })
    .optional(),
})
export type SlackSearchOAuthAttempt = z.infer<typeof attemptSchema>
const CONSUME = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local attempt = cjson.decode(value)
if attempt.userId ~= ARGV[1] or attempt.sessionId ~= ARGV[2] then return nil end
redis.call('DEL', KEYS[1])
return value
`

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error('Slack OAuth setup requires Redis')
  return redis
}

function stateKey(state: string) {
  return `slack-search:oauth:${sha256Hex(state)}`
}

export async function storeSlackSearchOAuthAttempt(attempt: SlackSearchOAuthAttempt) {
  const state = generateId()
  const saved = await requireRedis().set(
    stateKey(state),
    JSON.stringify(attemptSchema.parse(attempt)),
    'EX',
    TTL_SECONDS,
    'NX'
  )
  if (saved !== 'OK') throw new Error('Could not create Slack OAuth attempt')
  return state
}

/** Consumes only the initiating browser session's attempt; another session cannot invalidate it. */
export async function consumeSlackSearchOAuthAttempt(state: string, principal: SessionPrincipal) {
  const value = await requireRedis().eval(
    CONSUME,
    1,
    stateKey(state),
    principal.userId,
    principal.sessionId
  )
  if (typeof value !== 'string')
    throw new OrchestrationError(
      'validation',
      'Slack setup expired or was already completed. Start setup again.'
    )
  const attempt = attemptSchema.parse(JSON.parse(value))
  if (attempt.createdAt > Date.now() || Date.now() - attempt.createdAt > TTL_SECONDS * 1000) {
    throw new OrchestrationError('validation', 'Slack setup expired. Start setup again.')
  }
  return attempt
}
