import { sha256Hex } from '@sim/security/hash'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const redisUrl = readTestRedisUrl()
  if (redisUrl) process.env.REDIS_URL = redisUrl
  return { redisUrl }
})

import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'

afterAll(() => closeRedisConnection())

import {
  consumeDesktopSourceRequest,
  createDesktopSourceRequest,
} from '@/lib/desktop/application/source-requests'

/** Real Redis proves cross-session ownership and atomic consumption, without provider credentials. */
describe.skipIf(!redisUrl)('desktop source request transport', () => {
  it('allows the same user in another session, without letting another user consume the request', async () => {
    const userId = generateId()
    const created = await createDesktopSourceRequest.execute({
      principal: { kind: 'session', userId, sessionId: 'desktop-fixture' },
      input: { requestId: generateShortId(32), payload: '{"kind":"fixture"}' },
    })
    await expect(
      consumeDesktopSourceRequest.execute({
        principal: { kind: 'session', userId: generateId(), sessionId: 'foreign-fixture' },
        input: created,
      })
    ).rejects.toThrow('Connection request expired')
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        consumeDesktopSourceRequest.execute({
          principal: { kind: 'session', userId, sessionId: 'browser-fixture' },
          input: created,
        })
      )
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toEqual([
      { status: 'fulfilled', value: { payload: '{"kind":"fixture"}' } },
    ])
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(3)
  })

  it('encrypts transport secrets and expires abandoned requests', async () => {
    const principal = {
      kind: 'session' as const,
      userId: generateId(),
      sessionId: 'desktop-fixture',
    }
    const created = await createDesktopSourceRequest.execute({
      principal,
      input: { requestId: generateShortId(32), payload: 'fixture-secret-never-in-plaintext' },
    })
    const redis = getRedisClient()!
    const key = `desktop:source-request:${sha256Hex(created.requestId)}`
    const stored = await redis.get(key)
    expect(stored).not.toContain('fixture-secret-never-in-plaintext')
    expect(await redis.ttl(key)).toBeGreaterThan(0)
    expect(await redis.ttl(key)).toBeLessThanOrEqual(600)
    await redis.expire(key, 1)
    await sleep(1100)
    await expect(
      consumeDesktopSourceRequest.execute({ principal, input: created })
    ).rejects.toThrow('Connection request expired')
  })

  it('rejects non-session callers and oversized requests', async () => {
    await expect(
      createDesktopSourceRequest.execute({
        principal: { kind: 'workspace_api_key', workspaceId: generateId(), keyId: generateId() },
        input: { requestId: generateShortId(32), payload: '{}' },
      })
    ).rejects.toThrow('Session authentication required')
    await expect(
      createDesktopSourceRequest.execute({
        principal: { kind: 'session', userId: generateId(), sessionId: 'desktop-fixture' },
        input: { requestId: generateShortId(32), payload: 'x'.repeat(32769) },
      })
    ).rejects.toThrow('Connection request is too large')
  })
})
