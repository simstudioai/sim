/**
 * Deleting your own account and signing up again must not reset the one-time free allowance.
 * Runs against real PostgreSQL through the production deletion, signup-stats, fallback-stats,
 * and plan-sync paths.
 */
import { db } from '@sim/db'
import { account, deletedAccountIdentity, user, userStats } from '@sim/db/schema'
import { authMock } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  ensureUserStatsExists,
  handleNewSignInAccount,
  handleNewUser,
  syncUsageLimitsFromSubscription,
} from '@/lib/billing/core/usage'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'
import { deleteUserAccount } from '@/lib/users/account-deletion'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))
vi.mock('@/lib/auth', () => authMock)

const userIds: string[] = []
const recordedHashes: string[] = []

interface SignIn {
  providerId: string
  accountId: string
}

async function insertUser(email: string): Promise<string> {
  const id = generateId()
  userIds.push(id)
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Deleted identity fixture',
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

async function linkAccount(userId: string, { providerId, accountId }: SignIn) {
  const now = new Date()
  await db
    .insert(account)
    .values({ id: generateId(), userId, providerId, accountId, createdAt: now, updatedAt: now })
}

/**
 * Signs up the way Better Auth's `createOAuthUser` does: the user and its first sign-in account
 * commit together, then `user.create.after` and `account.create.after` run with one request context.
 */
async function signUp(email: string, firstSignIn?: SignIn): Promise<string> {
  const request = {}
  const id = await insertUser(email)
  if (firstSignIn) await linkAccount(id, firstSignIn)
  await handleNewUser(id, request)
  if (firstSignIn) await handleNewSignInAccount({ userId: id, ...firstSignIn }, request)
  return id
}

/** Links a sign-in account in a later request, the way `account.create.after` sees it. */
async function signInLater(userId: string, signIn: SignIn) {
  await linkAccount(userId, signIn)
  await handleNewSignInAccount({ userId, ...signIn }, {})
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

/** Deletes the account at its holder's request and returns the digests that deletion wrote. */
async function deleteOwnAccount(userId: string): Promise<string[]> {
  const before = new Set(
    (
      await db.select({ hash: deletedAccountIdentity.identityHash }).from(deletedAccountIdentity)
    ).map((row) => row.hash)
  )
  await deleteUserAccount(userId, { recordIdentity: true })
  const written = (
    await db.select({ hash: deletedAccountIdentity.identityHash }).from(deletedAccountIdentity)
  )
    .map((row) => row.hash)
    .filter((hash) => !before.has(hash))
  recordedHashes.push(...written)
  return written
}

afterAll(async () => {
  if (recordedHashes.length) {
    await db
      .delete(deletedAccountIdentity)
      .where(inArray(deletedAccountIdentity.identityHash, recordedHashes))
  }
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
})

describe('deleted account identities and the free allowance', () => {
  it('grants a first account the free allowance', async () => {
    const userId = await signUp(`first.${generateId()}@deleted-identity.test`)

    expect(await statsOf(userId)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })

  it('withholds the allowance from a new account on a self-deleted email', async () => {
    const email = `again.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))

    const returning = await signUp(email)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('matches the mailbox, not the spelling: case, +tags, Gmail dots and googlemail', async () => {
    const local = `farm${generateId().replaceAll('-', '')}`
    await deleteOwnAccount(
      await signUp(`${local.slice(0, 6)}.${local.slice(6)}+one@GoogleMail.com`)
    )

    const returning = await signUp(`${local.toUpperCase()}+two@gmail.com`)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('folds +tags only where the provider delivers them to the same mailbox', async () => {
    const local = `tagged${generateId().replaceAll('-', '')}`
    await deleteOwnAccount(await signUp(`${local}+one@deleted-identity.test`))

    const sameLocalPart = await signUp(`${local}@deleted-identity.test`)

    expect(await statsOf(sameLocalPart)).toEqual({
      freeTierEligible: true,
      limit: getFreeTierLimit(),
    })
  })

  it('still grants the allowance to a different person and to a record past its retention', async () => {
    const email = `expired.${generateId()}@deleted-identity.test`
    const written = await deleteOwnAccount(await signUp(email))
    const stranger = await signUp(`stranger.${generateId()}@deleted-identity.test`)
    await db
      .update(deletedAccountIdentity)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(inArray(deletedAccountIdentity.identityHash, written))

    const returningLate = await signUp(email)

    expect(await statsOf(stranger)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(returningLate)).toEqual({
      freeTierEligible: true,
      limit: getFreeTierLimit(),
    })
  })

  it('keeps a withheld allowance withheld through a plan re-sync, and keeps prepaid credit', async () => {
    const email = `resync.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))
    const returning = await signUp(email)
    await db.update(userStats).set({ creditBalance: '10' }).where(eq(userStats.userId, returning))

    await syncUsageLimitsFromSubscription(returning)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 10 })
  })

  it('withholds the allowance when a signup arrives on a deleted GitHub identity under a new email', async () => {
    const github = { providerId: 'github', accountId: `gh-${generateId()}` }
    const original = await signUp(`gh-old.${generateId()}@deleted-identity.test`, github)
    await deleteOwnAccount(original)

    const returning = await signUp(`gh-new.${generateId()}@deleted-identity.test`, github)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('withholds it when the signup’s sign-in account lands after the user hook ran', async () => {
    const github = { providerId: 'github', accountId: `gh-${generateId()}` }
    await deleteOwnAccount(
      await signUp(`gh-late-old.${generateId()}@deleted-identity.test`, github)
    )
    const request = {}
    const returning = await insertUser(`gh-late-new.${generateId()}@deleted-identity.test`)
    await handleNewUser(returning, request)
    expect(await statsOf(returning)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })

    await linkAccount(returning, github)
    await handleNewSignInAccount({ userId: returning, ...github }, request)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('never withholds for a sign-in linked after signup, or for an integration connection', async () => {
    const github = { providerId: 'github', accountId: `gh-${generateId()}` }
    await deleteOwnAccount(await signUp(`gh-gone.${generateId()}@deleted-identity.test`, github))

    const existing = await signUp(`linker.${generateId()}@deleted-identity.test`)
    await signInLater(existing, { providerId: 'google', accountId: `google-${generateId()}` })
    await signInLater(existing, github)
    const connector = await signUp(`connector.${generateId()}@deleted-identity.test`)
    await signInLater(connector, { providerId: 'github-repo', accountId: github.accountId })

    expect(await statsOf(existing)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(connector)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })

  it('never withholds when a provisioned user with no sign-in yet links one as its first account', async () => {
    const github = { providerId: 'github', accountId: `gh-${generateId()}` }
    await deleteOwnAccount(await signUp(`gh-prov.${generateId()}@deleted-identity.test`, github))
    const provisioned = await insertUser(`provisioned.${generateId()}@deleted-identity.test`)
    await handleNewUser(provisioned)

    await signInLater(provisioned, github)

    expect(await statsOf(provisioned)).toEqual({
      freeTierEligible: true,
      limit: getFreeTierLimit(),
    })
  })

  it('withholds the allowance from a stats row the fallback creates after signup failed to', async () => {
    const email = `fallback.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))
    const returning = await insertUser(email)
    const stranger = await insertUser(`fallback-stranger.${generateId()}@deleted-identity.test`)

    await ensureUserStatsExists(returning)
    await ensureUserStatsExists(stranger)
    await ensureUserStatsExists(returning)

    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
    expect(await statsOf(stranger)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })

  it('never withholds from a stats-less user’s fallback row for a sign-in linked in a later request', async () => {
    const google = { providerId: 'google', accountId: `google-${generateId()}` }
    await deleteOwnAccount(
      await signUp(`google-gone.${generateId()}@deleted-identity.test`, google)
    )
    const legacy = await insertUser(`legacy.${generateId()}@deleted-identity.test`)
    const laterRequest = {}
    await linkAccount(legacy, google)

    await ensureUserStatsExists(legacy, laterRequest)
    await handleNewSignInAccount({ userId: legacy, ...google }, laterRequest)

    expect(await statsOf(legacy)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })

  it('records only sign-in identities, as keyed digests holding no address or subject', async () => {
    const email = `digest.${generateId()}@deleted-identity.test`
    const githubSubject = `gh-${generateId()}`
    const userId = await signUp(email, { providerId: 'github', accountId: githubSubject })
    await linkAccount(userId, { providerId: 'slack', accountId: `T1-U1-${generateId()}` })

    const written = await deleteOwnAccount(userId)

    expect(written).toHaveLength(2)
    for (const hash of written) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(hash).not.toContain(email.split('@')[0])
      expect(hash).not.toContain(githubSubject)
    }
  })

  it('records nothing when deleting a just-provisioned account as a rollback', async () => {
    const email = `rollback.${generateId()}@deleted-identity.test`
    const before = await db
      .select({ hash: deletedAccountIdentity.identityHash })
      .from(deletedAccountIdentity)

    await deleteUserAccount(await signUp(email), { recordIdentity: false })
    const after = await db
      .select({ hash: deletedAccountIdentity.identityHash })
      .from(deletedAccountIdentity)
    const retry = await signUp(email)

    expect(after).toHaveLength(before.length)
    expect(await statsOf(retry)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })
})
