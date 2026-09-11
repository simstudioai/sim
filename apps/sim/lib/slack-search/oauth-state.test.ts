/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => ({ set: vi.fn(), eval: vi.fn() }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redis }))

import {
  consumeSlackSearchOAuthAttempt,
  storeSlackSearchOAuthAttempt,
} from '@/lib/slack-search/oauth-state'

const principal = { kind: 'session', userId: 'admin1', sessionId: 'session1' } as const
const attempt = {
  userId: 'admin1',
  sessionId: 'session1',
  organizationId: 'org1',
  name: 'Sim Search',
  description: 'Search',
  clientId: 'client',
  encryptedClientSecret: 'encrypted-client',
  encryptedSigningSecret: 'encrypted-signing',
  redirectUri: 'https://sim.test/callback',
  createdAt: Date.now(),
}
beforeEach(() => {
  vi.clearAllMocks()
  redis.set.mockResolvedValue('OK')
  redis.eval.mockResolvedValue(null)
})
describe('Slack OAuth state', () => {
  it('stores a ten-minute, non-overwriting attempt under a hashed state key', async () => {
    const state = await storeSlackSearchOAuthAttempt(attempt)
    const [key, value, expiryMode, ttl, condition] = redis.set.mock.calls[0]
    expect(key).not.toContain(state)
    expect(JSON.parse(value)).toEqual(attempt)
    expect([expiryMode, ttl, condition]).toEqual(['EX', 600, 'NX'])
  })
  it('stores only shared identity and revision without app secrets', async () => {
    const { encryptedClientSecret, encryptedSigningSecret, ...common } = attempt
    const shared = { ...common, sharedApp: { id: 'ASHARED', revision: 'env-revision' } }
    await storeSlackSearchOAuthAttempt(shared)
    expect(JSON.parse(redis.set.mock.calls[0][1])).toEqual(shared)
    redis.eval.mockResolvedValueOnce(JSON.stringify(shared))
    await expect(consumeSlackSearchOAuthAttempt('state', principal)).resolves.toEqual(shared)
  })
  it('consumes only for the initiating admin session and rejects replay', async () => {
    redis.eval.mockResolvedValueOnce(JSON.stringify(attempt))
    expect(await consumeSlackSearchOAuthAttempt('state', principal)).toEqual(attempt)
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('attempt.sessionId ~= ARGV[2]'),
      1,
      expect.any(String),
      'admin1',
      'session1'
    )
    await expect(consumeSlackSearchOAuthAttempt('state', principal)).rejects.toThrow(
      'already completed'
    )
  })
  it('rejects an expired attempt even when storage returns it', async () => {
    redis.eval.mockResolvedValueOnce(
      JSON.stringify({ ...attempt, createdAt: Date.now() - 601_000 })
    )
    await expect(consumeSlackSearchOAuthAttempt('state', principal)).rejects.toThrow('expired')
  })
  it('does not continue when state storage fails', async () => {
    redis.set.mockResolvedValueOnce(null)
    await expect(storeSlackSearchOAuthAttempt(attempt)).rejects.toThrow('Could not create')
  })
})
