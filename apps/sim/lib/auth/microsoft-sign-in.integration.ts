import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.MICROSOFT_CLIENT_ID = 'microsoft-sign-in-fixture-client'
  process.env.MICROSOFT_CLIENT_SECRET = 'microsoft-sign-in-fixture-secret'
})

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const MICROSOFT_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const APP_ORIGIN = 'http://localhost:3000'

function unsignedJwt(claims: Record<string, unknown>) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`
}

describe('Microsoft sign-in for an existing account', () => {
  let auth: typeof import('@/lib/auth/auth').auth
  let userId: string
  let email: string
  let subject: string
  let objectId: string

  beforeAll(async () => {
    ;({ auth } = await import('@/lib/auth/auth'))
  }, 90_000)

  beforeEach(async () => {
    userId = generateId()
    email = `${userId}@microsoft-sign-in.test`
    subject = `sub-${generateId()}`
    objectId = generateId()
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Microsoft sign-in fixture',
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(account).values({
      id: generateId(),
      accountId: subject,
      providerId: 'microsoft',
      userId,
      createdAt: now,
      updatedAt: now,
    })

    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === MICROSOFT_TOKEN_ENDPOINT) {
        return Response.json({
          access_token: 'microsoft-fixture-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email',
          id_token: unsignedJwt({
            iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
            aud: process.env.MICROSOFT_CLIENT_ID,
            tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
            sub: subject,
            oid: objectId,
            email,
            name: 'Microsoft sign-in fixture',
          }),
        })
      }
      if (url.startsWith('https://graph.microsoft.com/')) return new Response(null, { status: 404 })
      return realFetch(input, init)
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.delete(user).where(eq(user.id, userId))
  })

  it('signs in through the account stored under the ID token subject without a duplicate link', async () => {
    const start = await auth.handler(
      new Request(`${APP_ORIGIN}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
        body: JSON.stringify({ provider: 'microsoft', callbackURL: '/workspace' }),
      })
    )
    expect(start.status).toBe(200)
    const { url } = (await start.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')
    const stateCookies = start.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')

    const callback = await auth.handler(
      new Request(
        `${APP_ORIGIN}/api/auth/callback/microsoft?code=microsoft-fixture-code&state=${state}`,
        { headers: { cookie: stateCookies } }
      )
    )

    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toMatch(/\/workspace$/)
    expect(callback.headers.getSetCookie().some((value) => value.includes('session_token='))).toBe(
      true
    )
    const accounts = await db
      .select({ accountId: account.accountId })
      .from(account)
      .where(eq(account.userId, userId))
    expect(accounts).toEqual([{ accountId: subject }])
  })
})
