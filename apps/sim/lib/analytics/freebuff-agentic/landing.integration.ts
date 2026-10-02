import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sha256Base64Url } from '@sim/security/hash'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  FREEBUFF_AGENTIC_COOKIE,
  readFreebuffAttribution,
} from '@/lib/analytics/freebuff-agentic/token'
import { env } from '@/lib/core/config/env'
import { closeRedisConnection } from '@/lib/core/config/redis'
import {
  bindAccountAttribution,
  bindApprovedCliAttribution,
} from '@/lib/users/application/attribution'
import { POST } from '@/app/api/attribution/freebuff/handoff/route'
import { GET } from '@/app/api/attribution/freebuff/route'
import { POST as approveCli } from '@/app/api/cli/auth/approve/route'

vi.mock('@/lib/auth', () => authMock)
beforeAll(() => {
  Object.assign(env, { REDIS_URL: readTestRedisUrl() })
})
afterAll(async () => {
  await closeRedisConnection()
})

/** Real Redis and encrypted cookie boundary; OAuth providers are outside this fixture. */
describe('agentic landing and device handoff', () => {
  it('retains a failed browser capture for its original account only', async () => {
    const userId = generateId()
    const otherId = generateId()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
    const failed = await GET(
      new NextRequest('http://localhost:3000/api/attribution/freebuff?bfcid=fixture-retry-token', {
        headers: { 'x-forwarded-for': '127.0.0.8' },
      }),
      {}
    )
    expect(failed.status).toBe(503)
    const cookie = (failed.headers.get('set-cookie') ?? '').split(';')[0]
    const sealed = decodeURIComponent(cookie.slice(FREEBUFF_AGENTIC_COOKIE.length + 1))
    expect((await readFreebuffAttribution(sealed))?.boundUserId).toBe(userId)
    try {
      await db.insert(user).values(
        [userId, otherId].map((id) => ({
          id,
          name: 'Retry fixture',
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(0),
          updatedAt: new Date(),
        }))
      )
      await bindAccountAttribution.execute({
        principal: { kind: 'session', userId: otherId, sessionId: generateId() },
        input: { sealed },
      })
      expect(
        await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, otherId))
      ).toHaveLength(0)
      const retried = await GET(
        new NextRequest('http://localhost:3000/api/attribution/freebuff', {
          headers: { cookie, 'x-forwarded-for': '127.0.0.8' },
        }),
        {}
      )
      expect(retried.status).toBe(303)
      expect(retried.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(
        await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, userId))
      ).toHaveLength(1)
    } finally {
      for (const id of [userId, otherId]) {
        await db.delete(outboxEvent).where(sql`${outboxEvent.id} like ${`freebuff:expire:${id}:%`}`)
        await db.delete(user).where(eq(user.id, id))
      }
    }
  })

  it('reserves a failed CLI approval claim for the same account until persistence succeeds', async () => {
    const requestId = sha256Base64Url(generateId())
    const challenge = sha256Base64Url(generateId())
    const userId = generateId()
    const otherId = generateId()
    const registration = await POST(
      new NextRequest('http://localhost:3000/api/attribution/freebuff/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.9' },
        body: JSON.stringify({
          request: requestId,
          challenge,
          conversionToken: 'fixture-approval-retry',
        }),
      }),
      {}
    )
    expect(registration.status).toBe(204)
    const approve = (id: string) =>
      bindApprovedCliAttribution.execute({
        principal: { kind: 'session', userId: id, sessionId: generateId() },
        input: { requestId, challenge },
      })
    await expect(approve(userId)).rejects.toThrow()
    try {
      await db.insert(user).values(
        [userId, otherId].map((id) => ({
          id,
          name: 'Claim fixture',
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(0),
          updatedAt: new Date(),
        }))
      )
      await approve(otherId)
      expect(
        await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, otherId))
      ).toHaveLength(0)
      await approve(userId)
      await approve(otherId)
      expect(
        await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, otherId))
      ).toHaveLength(0)
      expect(
        await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, userId))
      ).toHaveLength(1)
    } finally {
      for (const id of [userId, otherId]) {
        await db.delete(outboxEvent).where(sql`${outboxEvent.id} like ${`freebuff:expire:${id}:%`}`)
        await db.delete(user).where(eq(user.id, id))
      }
    }
  })

  it('consumes the browser cookie after binding an authenticated account', async () => {
    const userId = generateId()
    await db.insert(user).values({
      id: userId,
      name: 'Fixture',
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(0),
      updatedAt: new Date(),
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
    try {
      const response = await GET(
        new NextRequest(
          'http://localhost:3000/api/attribution/freebuff?bfcid=fixture-signed-in-token',
          {
            headers: { 'x-forwarded-for': '127.0.0.6' },
          }
        ),
        {}
      )
      expect(response.status).toBe(303)
      expect(response.headers.get('set-cookie')).toContain(`${FREEBUFF_AGENTIC_COOKIE}=;`)
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(
        await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, userId))
      ).toHaveLength(1)
    } finally {
      await db
        .delete(outboxEvent)
        .where(sql`${outboxEvent.id} like ${`freebuff:expire:${userId}:%`}`)
      await db.delete(user).where(eq(user.id, userId))
    }
  })

  it('returns a retryable rate limit without completing an uncaptured handoff', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    let response: Response | undefined
    for (let attempt = 0; attempt < 11; attempt++) {
      response = await GET(
        new NextRequest(
          'http://localhost:3000/api/attribution/freebuff?bfcid=fixture-limited-token',
          {
            headers: { 'x-forwarded-for': '127.0.0.7' },
          }
        ),
        {}
      )
    }
    expect(response?.status).toBe(429)
    expect(response?.headers.get('location')).toBeNull()
    expect(response?.headers.get('retry-after')).toBeTruthy()
    expect(response?.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('removes the token before a page can load analytics and seals the cookie', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const token = 'fixture-browser-token'
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/attribution/freebuff?bfcid=${token}`, {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      }),
      {}
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000/signup')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain(token)
    const sealed = cookie.split(';')[0].slice(FREEBUFF_AGENTIC_COOKIE.length + 1)
    expect((await readFreebuffAttribution(decodeURIComponent(sealed)))?.token).toBe(token)
  })

  it('persists the CLI token before browser arrival and keeps it out of the approval URL', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    const request = sha256Base64Url(generateId())
    const challenge = sha256Base64Url(generateId())
    const token = 'fixture-cli-token'
    const registration = await POST(
      new NextRequest('http://localhost:3000/api/attribution/freebuff/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.2' },
        body: JSON.stringify({ request, challenge, conversionToken: token }),
      }),
      {}
    )
    expect(registration.status).toBe(204)
    authMockFns.mockGetSession.mockRejectedValueOnce(new Error('Fixture session outage'))
    const failed = await GET(
      new NextRequest(
        `http://localhost:3000/api/attribution/freebuff?request=${request}&challenge=${challenge}&pairing=ABCD-EFGH`,
        { headers: { 'x-forwarded-for': '127.0.0.2' } }
      ),
      {}
    )
    expect(failed.status).toBe(503)
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/attribution/freebuff?request=${request}&challenge=${challenge}&pairing=ABCD-EFGH`,
        { headers: { 'x-forwarded-for': '127.0.0.2' } }
      ),
      {}
    )
    const locationHeader = response.headers.get('location')
    if (!locationHeader) throw new Error('Missing approval redirect')
    const location = new URL(locationHeader)
    expect(location.pathname).toBe('/cli/auth')
    expect(location.searchParams.get('request')).toBe(request)
    expect(location.href).not.toContain(token)
    expect(response.headers.get('set-cookie')).toBeNull()
    const userId = generateId()
    await db.insert(user).values({
      id: userId,
      name: 'CLI fixture',
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })
    try {
      const approved = await approveCli(
        new NextRequest('http://localhost:3000/api/cli/auth/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request, challenge, scope: 'platform' }),
        }),
        {}
      )
      expect(approved.status, await approved.clone().text()).toBe(200)
      const [association] = await db
        .select()
        .from(freebuffAttribution)
        .where(eq(freebuffAttribution.userId, userId))
      expect((await readFreebuffAttribution(association.encryptedToken))?.token).toBe(token)
    } finally {
      await db
        .delete(outboxEvent)
        .where(
          sql`${outboxEvent.id} = ${`freebuff:account_created:${userId}`} or ${outboxEvent.id} like ${`freebuff:expire:${userId}:%`}`
        )
      await db.delete(user).where(eq(user.id, userId))
      authMockFns.mockGetSession.mockResolvedValue(null)
    }
    const replay = await GET(
      new NextRequest(locationHeader.replace('/cli/auth', '/api/attribution/freebuff'), {
        headers: { 'x-forwarded-for': '127.0.0.5' },
      }),
      {}
    )
    expect(replay.headers.get('set-cookie')).toBeNull()
    const wrongChallenge = await GET(
      new NextRequest(
        `http://localhost:3000/api/attribution/freebuff?request=${request}&challenge=${sha256Base64Url(generateId())}&pairing=ABCD-EFGH`,
        { headers: { 'x-forwarded-for': '127.0.0.3' } }
      ),
      {}
    )
    expect(wrongChallenge.headers.get('set-cookie')).toBeNull()
  })

  it('keeps an ordinary signup redirect usable without attribution', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/attribution/freebuff', {
        headers: { 'x-forwarded-for': '127.0.0.4' },
      }),
      {}
    )
    expect(response.headers.get('location')).toBe('http://localhost:3000/signup')
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

import { db } from '@sim/db'
import { freebuffAttribution, outboxEvent, user } from '@sim/db/schema'
