import { db } from '@sim/db'
import { freebuffAttribution, outboxEvent, user } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FREEBUFF_AGENTIC_COOKIE,
  sealFreebuffAttribution,
} from '@/lib/analytics/freebuff-agentic/token'
import { auth } from '@/lib/auth'

const emails = [`${generateId()}@example.test`, `${generateId()}@example.test`]
const origin = 'http://localhost:3000'

afterAll(async () => {
  const accounts = await db.select({ id: user.id }).from(user).where(inArray(user.email, emails))
  for (const account of accounts) {
    await db
      .delete(outboxEvent)
      .where(
        sql`${outboxEvent.id} = ${`freebuff:account_created:${account.id}`} or ${outboxEvent.id} like ${`freebuff:expire:${account.id}:%`}`
      )
    await db.delete(user).where(eq(user.id, account.id))
  }
})

/** Exercises the production Better Auth lifecycle against PostgreSQL, including cookie consumption. */
describe('agentic attribution through authentication', () => {
  it('attributes self-registration once, consumes the cookie, and excludes admin provisioning', async () => {
    const sealed = await sealFreebuffAttribution('fixture-auth-token')
    const attributionCookie = `${FREEBUFF_AGENTIC_COOKIE}=${encodeURIComponent(sealed)}`
    const signup = await auth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie: attributionCookie },
        body: JSON.stringify({
          name: 'Attribution fixture',
          email: emails[0],
          password: 'Fixture-password-928!',
        }),
      })
    )
    expect(signup.status, await signup.clone().text()).toBe(200)
    const cookies = signup.headers.getSetCookie()
    expect(
      cookies.some(
        (cookie) => cookie.startsWith(`${FREEBUFF_AGENTIC_COOKIE}=`) && cookie.includes('Max-Age=0')
      )
    ).toBe(true)
    const [account] = await db.select().from(user).where(eq(user.email, emails[0]))
    if (!account) throw new Error('Signup did not persist its account')
    const [association] = await db
      .select()
      .from(freebuffAttribution)
      .where(eq(freebuffAttribution.userId, account.id))
    expect(association.encryptedToken).toBe(sealed)
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, `freebuff:account_created:${account.id}`))
    expect(event.payload).toMatchObject({
      eventType: 'account_created',
      occurredAt: account.createdAt.toISOString(),
    })

    await db.update(user).set({ role: 'admin' }).where(eq(user.id, account.id))
    await sleep(2)
    const returningToken = await sealFreebuffAttribution('fixture-returning-token')
    const signin = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          cookie: `${FREEBUFF_AGENTIC_COOKIE}=${encodeURIComponent(returningToken)}`,
        },
        body: JSON.stringify({ email: emails[0], password: 'Fixture-password-928!' }),
      })
    )
    expect(signin.status).toBe(200)
    const [original] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, event.id))
    expect(original.payload).toEqual(event.payload)

    const sessionCookie = signin.headers
      .getSetCookie()
      .filter((cookie) => !cookie.startsWith(`${FREEBUFF_AGENTIC_COOKIE}=`))
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
    const provisioned = await auth.handler(
      new Request(`${origin}/api/auth/admin/create-user`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          cookie: `${sessionCookie}; ${attributionCookie}`,
        },
        body: JSON.stringify({
          name: 'Provisioned fixture',
          email: emails[1],
          password: 'Fixture-password-729!',
        }),
      })
    )
    expect(provisioned.status, await provisioned.clone().text()).toBe(200)
    const [managed] = await db.select().from(user).where(eq(user.email, emails[1]))
    if (!managed) throw new Error('Admin provisioning did not persist its account')
    expect(
      await db.select().from(freebuffAttribution).where(eq(freebuffAttribution.userId, managed.id))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(outboxEvent)
        .where(eq(outboxEvent.id, `freebuff:account_created:${managed.id}`))
    ).toHaveLength(0)
  })
})
