/**
 * A dot, `+tag`, or `googlemail.com` variant of an existing Gmail address must not get a second
 * free allowance. Runs against real PostgreSQL through the production signup-stats and
 * fallback-stats paths, and checks the lookup is served by `user_gmail_mailbox_idx`.
 */
import { db } from '@sim/db'
import { gmailMailbox, user, userStats } from '@sim/db/schema'
import { authMock } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ensureUserStatsExists, handleNewUser } from '@/lib/billing/core/usage'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'

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
    const alias = await insertUser(`${local.slice(0, 3)}.${local.slice(3)}@gmail.com`)

    await ensureUserStatsExists(alias)

    expect(await statsOf(alias)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('keeps the allowance with the inbox’s first account when its stats row comes after an alias’s', async () => {
    const local = uniqueLocalPart()
    const original = await insertUser(`${local}@gmail.com`, {
      createdAt: new Date(Date.now() - 60_000),
    })
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

  it('finds the inbox through user_gmail_mailbox_idx rather than a scan of user', async () => {
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`)
      const rows = await tx.execute<{ 'QUERY PLAN': string }>(
        sql`EXPLAIN SELECT ${user.id} FROM ${user} WHERE ${gmailMailbox(user.email)} = ${`${uniqueLocalPart()}@gmail.com`} LIMIT 1`
      )
      return rows.map((row) => row['QUERY PLAN']).join('\n')
    })

    expect(plan).toContain('user_gmail_mailbox_idx')
  })
})
