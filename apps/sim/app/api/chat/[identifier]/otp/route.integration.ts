import { db } from '@sim/db'
import { chat, user, workflow, workspace } from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { redisClient } = vi.hoisted(() => ({
  redisClient: { current: undefined as Redis | undefined },
}))
vi.mock('@/lib/core/config/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/redis')>()),
  getRedisClient: () => redisClient.current,
}))

import { MAX_OTP_ATTEMPTS, storeOTP } from '@/lib/core/security/otp'
import { PUT } from '@/app/api/chat/[identifier]/otp/route'

const redisUrl = readTestRedisUrl()
const ownerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const chatId = generateId()
const identifier = `otp-${chatId}`
const email = `${generateId()}@otp.invalid`
const CODE = '246810'
const NEWER_CODE = '135791'
const NO_CODE = 'No verification code found, request a new one'
const INVALID = 'Invalid verification code'
const LOCKED = 'Too many failed attempts. Please request a new code.'

async function verify(otp: string) {
  const request = createMockRequest({
    method: 'PUT',
    url: `/api/chat/${identifier}/otp`,
    body: { email, otp },
  })
  const response = await PUT(request, createRouteContext({ identifier }))
  const body = (await response.json()) as { error?: string; message?: string }
  return {
    status: response.status,
    error: body.error ?? body.message,
    cookie: response.headers.get('set-cookie'),
  }
}

/** Distinct wrong six-digit guesses that never equal {@link CODE}. */
function wrongGuesses(count: number) {
  return Array.from({ length: count }, (_, index) => String(100000 + index))
}

beforeAll(async () => {
  await db.insert(user).values({
    id: ownerId,
    name: 'OTP fixture',
    email: `${ownerId}@otp.invalid`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'OTP fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'OTP fixture',
    lastSynced: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(chat).values({
    id: chatId,
    workflowId,
    userId: ownerId,
    identifier,
    title: 'OTP fixture',
    authType: 'email',
    allowedEmails: [email],
  })
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await redisClient.current?.quit()
})

describe('chat OTP verification', () => {
  describe('real Redis storage', () => {
    beforeAll(async () => {
      redisClient.current = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0 })
      await redisClient.current.connect()
    })
    beforeEach(async () => {
      await storeOTP('chat', chatId, email, CODE)
    })
    afterEach(async () => {
      vi.restoreAllMocks()
      await db
        .update(chat)
        .set({ authType: 'email', allowedEmails: [email] })
        .where(eq(chat.id, chatId))
    })

    it.each([
      {
        rejection: 'the chat no longer uses email auth',
        change: { authType: 'public' },
        response: { status: 400, error: 'This chat does not use email authentication' },
      },
      {
        rejection: 'the email is no longer allowed',
        change: { allowedEmails: ['someone-else@otp.invalid'] },
        response: { status: 403, error: 'Email not authorized' },
      },
    ])('rejects without spending the code when $rejection', async ({ change, response }) => {
      await db.update(chat).set(change).where(eq(chat.id, chatId))
      for (let attempt = 0; attempt < MAX_OTP_ATTEMPTS; attempt++) {
        expect(await verify(CODE)).toMatchObject({ ...response, cookie: null })
      }
      await db
        .update(chat)
        .set({ authType: 'email', allowedEmails: [email] })
        .where(eq(chat.id, chatId))
      expect(await verify(CODE)).toMatchObject({ status: 200 })
    })

    it('compares at most the attempt limit of guesses however many arrive concurrently', async () => {
      const results = await Promise.all(wrongGuesses(30).map(verify))

      const compared = results.filter((result) => result.error !== NO_CODE)
      expect(compared).toHaveLength(MAX_OTP_ATTEMPTS)
      expect(compared.filter((result) => result.error === INVALID)).toHaveLength(
        MAX_OTP_ATTEMPTS - 1
      )
      expect(compared.filter((result) => result.error === LOCKED)).toHaveLength(1)
      expect(await verify(CODE)).toMatchObject({ status: 400, error: NO_CODE, cookie: null })
    })

    it('lets only one of several concurrent correct submissions succeed', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => verify(CODE)))

      const accepted = results.filter((result) => result.status === 200)
      expect(accepted).toHaveLength(1)
      expect(accepted[0].cookie).toContain(`chat_auth_${chatId}=`)
      expect(results.filter((result) => result.cookie !== null)).toHaveLength(1)
    })

    it('keeps a newer code issued while an older correct submission is in flight', async () => {
      const replaceCode = () => storeOTP('chat', chatId, email, NEWER_CODE)
      const client = redisClient.current
      if (!client) throw new Error('Redis client was not connected')
      const evaluate = client.eval.bind(client)
      let calls = 0
      vi.spyOn(client, 'eval').mockImplementation(async (...args) => {
        calls += 1
        if (calls === 2) await replaceCode()
        return evaluate(...args)
      })

      expect(await verify(CODE)).toMatchObject({ status: 400, error: NO_CODE, cookie: null })
      expect(await verify(NEWER_CODE)).toMatchObject({ status: 200 })
    })

    it('treats a code with no expiry as expired', async () => {
      const key = `otp:${email}:${chatId}`
      await redisClient.current?.set(key, `${CODE}:${MAX_OTP_ATTEMPTS - 1}`)
      expect(await verify(CODE)).toMatchObject({ status: 400, error: NO_CODE, cookie: null })
      expect(await redisClient.current?.exists(key)).toBe(0)
    })

    it('accepts the correct code on the last remaining attempt and mints the auth cookie', async () => {
      for (const guess of wrongGuesses(MAX_OTP_ATTEMPTS - 1)) {
        expect(await verify(guess)).toMatchObject({ status: 400, error: INVALID })
      }
      const accepted = await verify(CODE)
      expect(accepted.status).toBe(200)
      expect(accepted.cookie).toContain(`chat_auth_${chatId}=`)
      expect(await verify(CODE)).toMatchObject({ status: 400, error: NO_CODE })
    })

    it('keeps the code expiry when a failed attempt is recorded', async () => {
      const key = `otp:${email}:${chatId}`
      await redisClient.current?.pexpire(key, 900)
      expect(await verify('999999')).toMatchObject({ status: 400, error: INVALID })
      const ttl = await redisClient.current?.pttl(key)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(900)
    })
  })
})
