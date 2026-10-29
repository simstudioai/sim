/**
 * A dot, `+tag`, or `googlemail.com` variant of an existing Gmail address must not get a second
 * free allowance, even when two signups on one inbox race. Runs against real PostgreSQL through
 * the production signup-stats and fallback-stats paths, and checks the lookup is served by
 * `user_gmail_mailbox_idx`.
 */
import { db } from '@sim/db'
import { gmailMailbox, user, userStats } from '@sim/db/schema'
import { createDeferred } from '@sim/testing'
import { authMock } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ensureUserStatsExists, handleNewUser } from '@/lib/billing/core/usage'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'
import { acquireGmailInboxLock } from '@/lib/users/gmail-alias'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))
vi.mock('@/lib/auth', () => authMock)

const userIds: string[] = []

async function insertUser(
  email: string,
  { banned = false, emailVerified = true, createdAt = new Date() } = {}
): Promise<string> {
  const id = generateId()
  userIds.push(id)
  await db.insert(user).values({
    id,
    name: 'Gmail alias fixture',
    email,
    emailVerified,
    banned,
    createdAt,
    updatedAt: createdAt,
  })
  return id
}

async function signUp(
  email: string,
  options?: { banned?: boolean; emailVerified?: boolean }
): Promise<string> {
  const id = await insertUser(email, options)
  await handleNewUser(id, {})
  return id
}

async function statsOf(userId: string) {
  const [row] = await db
    .select({
      freeTierEligible: userStats.freeTierEligible,
      currentUsageLimit: userStats.currentUsageLimit,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
  return { freeTierEligible: row?.freeTierEligible, limit: Number(row?.currentUsageLimit) }
}

/** An account created a minute ago, so any account inserted after it counts as later. */
function insertEarlierUser(email: string): Promise<string> {
  return insertUser(email, { createdAt: new Date(Date.now() - 60_000) })
}

/** A Gmail local part no other test run can collide with. */
function uniqueLocalPart(): string {
  return `alias${generateId().replaceAll('-', '')}`
}

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
})

describe('Gmail inboxes and the free allowance', () => {
  it('withholds the allowance from dot, +tag, and googlemail variants of a live account', async () => {
    const local = uniqueLocalPart()
    const original = await signUp(`${local}@gmail.com`)

    const dotted = await signUp(`${local.slice(0, 4)}.${local.slice(4)}@gmail.com`)
    const tagged = await signUp(`${local}+farm@gmail.com`)
    const googlemail = await signUp(`${local.toUpperCase()}@GoogleMail.com`)

    expect(await statsOf(original)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    for (const variant of [dotted, tagged, googlemail]) {
      expect(await statsOf(variant)).toEqual({ freeTierEligible: false, limit: 0 })
    }
  })

  it('withholds it when the inbox belongs to a banned account', async () => {
    const local = uniqueLocalPart()
    await signUp(`${local}@gmail.com`, { banned: true })

    const returning = await signUp(`${local}+again@gmail.com`)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('withholds it from aliases registered before any of them verified the inbox', async () => {
    const local = uniqueLocalPart()
    const first = await signUp(`${local}@gmail.com`, { emailVerified: false })
    const second = await signUp(`${local}+two@gmail.com`, { emailVerified: false })
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(inArray(user.id, [first, second]))

    const third = await signUp(`${local.slice(0, 5)}.${local.slice(5)}@gmail.com`)

    expect(await statsOf(first)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(second)).toEqual({ freeTierEligible: false, limit: 0 })
    expect(await statsOf(third)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('grants it to a different Gmail inbox and never folds addresses outside Gmail', async () => {
    const local = uniqueLocalPart()
    await signUp(`${local}@gmail.com`)
    await signUp(`${local}+one@gmail-alias.test`)

    const otherInbox = await signUp(`${local}x@gmail.com`)
    const otherDomain = await signUp(`${local}@gmail-alias.test`)

    expect(await statsOf(otherInbox)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(otherDomain)).toEqual({
      freeTierEligible: true,
      limit: getFreeTierLimit(),
    })
  })

  it('withholds it from a stats row the fallback creates after signup failed to', async () => {
    const local = uniqueLocalPart()
    await signUp(`${local}@gmail.com`)
    const later = await insertUser(`${local.slice(0, 3)}.${local.slice(3)}@gmail.com`)

    await ensureUserStatsExists(later)

    expect(await statsOf(later)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('keeps the allowance with the inbox’s first account when its stats row comes after an alias’s', async () => {
    const local = uniqueLocalPart()
    const original = await insertEarlierUser(`${local}@gmail.com`)
    const alias = await signUp(`${local}+later@gmail.com`)

    await ensureUserStatsExists(original)

    expect(await statsOf(original)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(alias)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('withholds from exactly one of two accounts created at the same instant', async () => {
    const local = uniqueLocalPart()
    const createdAt = new Date()
    const first = await insertUser(`${local}@gmail.com`, { createdAt })
    const second = await insertUser(`${local.slice(0, 2)}.${local.slice(2)}@gmail.com`, {
      createdAt,
    })

    await ensureUserStatsExists(first)
    await ensureUserStatsExists(second)

    const eligible = [await statsOf(first), await statsOf(second)].map(
      (stats) => stats.freeTierEligible
    )
    expect(eligible.sort()).toEqual([false, true])
  })

  it('withdraws it from an alias whose signup decided before the earlier account was visible', async () => {
    const local = uniqueLocalPart()
    const later = await signUp(`${local}+fast@gmail.com`)
    const original = await insertEarlierUser(`${local}@gmail.com`)

    await handleNewUser(original, {})

    expect(await statsOf(original)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(later)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('never withdraws it from a later alias when the fallback creates the earlier account’s row', async () => {
    const local = uniqueLocalPart()
    const original = await insertEarlierUser(`${local}@gmail.com`)
    const later = await signUp(`${local}+later@gmail.com`)
    await db.update(userStats).set({ freeTierEligible: true }).where(eq(userStats.userId, later))

    await ensureUserStatsExists(original)

    expect(await statsOf(original)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect((await statsOf(later)).freeTierEligible).toBe(true)
  })

  it('makes a racing signup on the same inbox wait for the inbox lock', async () => {
    const local = uniqueLocalPart()
    const original = await insertEarlierUser(`${local}@gmail.com`)
    const racer = await insertUser(`${local.slice(0, 4)}.${local.slice(4)}@gmail.com`)
    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const pending: Promise<unknown>[] = []
    try {
      const holder = db.transaction(async (tx) => {
        await acquireGmailInboxLock(tx, original)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
      })
      pending.push(holder)
      void holder.catch((error: unknown) => held.reject(error))
      const blockerPid = await held.promise
      const signup = handleNewUser(racer, {})
      pending.push(signup)

      await vi.waitFor(
        async () => {
          const [waiting] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database()
              AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
          `)
          expect(waiting).toBeDefined()
        },
        { timeout: 5_000, interval: 25 }
      )
      expect((await statsOf(racer)).freeTierEligible).toBeUndefined()

      release.resolve()
      await holder
      await signup
      expect(await statsOf(racer)).toEqual({ freeTierEligible: false, limit: 0 })
    } finally {
      release.resolve()
      await Promise.allSettled(pending)
    }
  })

  it('finds the inbox through user_gmail_mailbox_idx rather than a scan of user', async () => {
    const subject = alias(user, 'subject')
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`)
      const rows = await tx.execute<{ 'QUERY PLAN': string }>(
        sql`EXPLAIN SELECT ${user.id} FROM ${user} AS "subject" JOIN ${user} ON ${gmailMailbox(user.email)} = ${gmailMailbox(subject.email)} WHERE ${subject.id} = ${generateId()}`
      )
      return rows.map((row) => row['QUERY PLAN']).join('\n')
    })

    expect(plan).toContain('user_gmail_mailbox_idx')
  })
})
