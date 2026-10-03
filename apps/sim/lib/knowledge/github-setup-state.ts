import type { SessionPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const GITHUB_SETUP_TTL_MS = 10 * 60 * 1000
const scopeSchema = z
  .object({
    organizationId: z.string().min(1).max(200),
    setupId: z.string().uuid(),
    userId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
  })
  .strict()
export type GitHubSetupScope = z.infer<typeof scopeSchema>

const installationSchema = z
  .object({
    installationId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(32),
    accountId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(32),
    accountLogin: z.string().min(1).max(100),
    accountType: z.enum(['User', 'Organization']),
  })
  .strict()
const baseSchema = scopeSchema.extend({
  createdAt: z.number().int().nonnegative(),
  intent: z.literal('install').optional(),
})
const attemptSchema = z.discriminatedUnion('phase', [
  baseSchema.extend({ phase: z.literal('starting') }),
  baseSchema.extend({ phase: z.literal('oauth'), url: z.string().url().max(8192) }),
  baseSchema.extend({ phase: z.literal('authorizing'), url: z.string().url().max(8192) }),
  baseSchema.extend({
    phase: z.literal('choosing'),
    installations: z.array(installationSchema).min(1).max(1000),
  }),
  baseSchema.extend({ phase: z.literal('installing'), state: z.string().uuid() }),
  baseSchema.extend({
    phase: z.literal('connecting'),
    installationId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(32),
    state: z.string().uuid().optional(),
  }),
  baseSchema.extend({
    phase: z.literal('completed'),
    credential: z
      .object({ id: z.string().min(1).max(200), displayName: z.string().min(1).max(500) })
      .strict(),
  }),
  baseSchema.extend({ phase: z.literal('failed'), error: z.string().min(1).max(1000) }),
  baseSchema.extend({ phase: z.literal('cancelled') }),
])
export type GitHubSetupAttempt = z.infer<typeof attemptSchema>
export type GitHubSetupPhase = GitHubSetupAttempt['phase']

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('GitHub setup requires Redis')
  return client
}

function attemptKey(scope: GitHubSetupScope) {
  return `github-search:setup:${sha256Hex(JSON.stringify([scope.organizationId, scope.userId, scope.setupId]))}`
}

function callbackKey(state: string) {
  return `github-search:setup-callback:${sha256Hex(state)}`
}

export function expiredGitHubSetupError() {
  return new OrchestrationError('validation', 'GitHub setup expired or was canceled. Start again.')
}

/** Retains the original expiry across refreshes and retries. */
function remainingTtl(createdAt: number) {
  const remaining = createdAt + GITHUB_SETUP_TTL_MS - Date.now()
  if (createdAt > Date.now() || remaining <= 0) throw expiredGitHubSetupError()
  return remaining
}

export function githubSetupScope(attempt: GitHubSetupScope): GitHubSetupScope {
  return scopeSchema.parse({
    organizationId: attempt.organizationId,
    setupId: attempt.setupId,
    userId: attempt.userId,
    sessionId: attempt.sessionId,
  })
}

const TRANSITION = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
local next = cjson.decode(ARGV[1])
if current.phase ~= ARGV[2] or current.userId ~= next.userId or current.sessionId ~= next.sessionId or current.organizationId ~= next.organizationId or current.setupId ~= next.setupId or current.createdAt ~= next.createdAt then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1
`

/** Atomically claims a lifecycle transition; cancellation cannot be overwritten by stale work. */
export async function saveGitHubSetupAttempt(
  attempt: GitHubSetupAttempt,
  expected: GitHubSetupPhase | 'new'
) {
  const key = attemptKey(attempt)
  const value = JSON.stringify(attemptSchema.parse(attempt))
  const ttl = remainingTtl(attempt.createdAt)
  const saved =
    expected === 'new'
      ? (await redis().set(key, value, 'PX', ttl, 'NX')) === 'OK'
      : (await redis().eval(TRANSITION, 1, key, value, expected, ttl)) === 1
  if (!saved)
    throw new OrchestrationError(
      'conflict',
      'GitHub setup changed. Refresh to continue or start again.'
    )
}

export async function readGitHubSetupAttempt(
  scope: GitHubSetupScope
): Promise<GitHubSetupAttempt | null> {
  const raw = await redis().get(attemptKey(scope))
  if (!raw) return null
  const attempt = attemptSchema.parse(JSON.parse(raw))
  if (
    attempt.organizationId !== scope.organizationId ||
    attempt.userId !== scope.userId ||
    attempt.setupId !== scope.setupId ||
    attempt.sessionId !== scope.sessionId ||
    attempt.createdAt > Date.now() ||
    Date.now() - attempt.createdAt >= GITHUB_SETUP_TTL_MS
  )
    return null
  return attempt
}

/** Only a random, server-issued nonce is sent to GitHub; the owner remains in Redis. */
export async function issueGitHubSetupCallback(attempt: GitHubSetupAttempt) {
  const state = generateId()
  const stored = await redis().set(
    callbackKey(state),
    JSON.stringify(githubSetupScope(attempt)),
    'PX',
    remainingTtl(attempt.createdAt),
    'NX'
  )
  if (stored !== 'OK') throw new Error('Could not create GitHub setup state')
  return state
}

/** A different browser session cannot consume or discover an attempt through its callback. */
export async function resolveGitHubSetupCallback(state: string, principal: SessionPrincipal) {
  const raw = await redis().get(callbackKey(state))
  if (!raw) throw expiredGitHubSetupError()
  const scope = scopeSchema.parse(JSON.parse(raw))
  if (scope.userId !== principal.userId || scope.sessionId !== principal.sessionId)
    throw expiredGitHubSetupError()
  const attempt = await readGitHubSetupAttempt(scope)
  if (!attempt) throw expiredGitHubSetupError()
  return scope
}
