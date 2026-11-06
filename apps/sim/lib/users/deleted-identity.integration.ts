/**
 * Deleting your own account and signing up again must not reset the one-time free allowance.
 * Runs against real PostgreSQL through the production deletion, signup-stats, fallback-stats,
 * and plan-sync paths.
 */
import { db } from '@sim/db'
import {
  account,
  deletedAccountIdentity,
  member,
  organization,
  user,
  userStats,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing'
import { authMock } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { generateRandomHex } from '@sim/utils/random'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  createUserStatsIfMissing,
  ensureUserStatsExists,
  handleNewSignInAccount,
  handleNewUser,
  syncUsageLimitsFromSubscription,
} from '@/lib/billing/core/usage'
import { transferOrganizationOwnership } from '@/lib/billing/organizations/membership'
import { checkAndIncrementStorageUsageInTx } from '@/lib/billing/storage/tracking'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { purgeExpiredDeletedAccountIdentities } from '@/lib/users/deleted-identity'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))
vi.mock('@/lib/auth', () => authMock)

const userIds: string[] = []
const organizationIds: string[] = []
const recordedHashes: string[] = []

interface SignIn {
  providerId: string
  accountId: string
}

async function insertUser(email: string, { emailVerified = true } = {}): Promise<string> {
  const id = generateId()
  userIds.push(id)
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Deleted identity fixture',
    email,
    emailVerified,
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
  if (organizationIds.length)
    await db.delete(organization).where(inArray(organization.id, organizationIds))
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

  it('withholds the allowance from a stats row a storage write creates', async () => {
    const email = `storage.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))
    const returning = await insertUser(email)
    const stranger = await insertUser(`storage-stranger.${generateId()}@deleted-identity.test`)
    const store = (userId: string) =>
      db.transaction((tx) => checkAndIncrementStorageUsageInTx(tx, null, userId, 1024))

    const first = await store(returning)
    const second = await store(returning)
    await store(stranger)

    expect([first.allowed, second.allowed]).toEqual([true, true])
    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
    expect(await statsOf(stranger)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    const [stored] = await db
      .select({ bytes: userStats.storageUsedBytes })
      .from(userStats)
      .where(eq(userStats.userId, returning))
    expect(stored.bytes).toBe(2048)
  })

  it('withholds the allowance from a stats row an ownership transfer creates for the new owner', async () => {
    const email = `new-owner.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))
    const owner = await signUp(`owner.${generateId()}@deleted-identity.test`)
    const newOwner = await insertUser(email)
    const organizationId = generateId()
    organizationIds.push(organizationId)
    const now = new Date()
    await db.insert(organization).values({
      id: organizationId,
      name: 'Transfer fixture',
      slug: `transfer-${organizationId}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values([
      { id: generateId(), organizationId, userId: owner, role: 'owner', createdAt: now },
      { id: generateId(), organizationId, userId: newOwner, role: 'member', createdAt: now },
    ])

    const result = await transferOrganizationOwnership({
      organizationId,
      currentOwnerUserId: owner,
      newOwnerUserId: newOwner,
    })

    expect(result).toMatchObject({ success: true })
    expect(await statsOf(newOwner)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('leaves an existing stats row untouched on a returning identity', async () => {
    const email = `existing.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))
    const returning = await insertUser(email)
    await db.insert(userStats).values({ id: generateId(), userId: returning })

    const created = await db.transaction((tx) => createUserStatsIfMissing(tx, returning))

    expect(created).toBe(false)
    expect(await statsOf(returning)).toMatchObject({ freeTierEligible: true })
  })

  it('fails open without aborting the caller’s transaction when the identity lookup fails', async () => {
    const email = `lookup-fails.${generateId()}@deleted-identity.test`
    await deleteOwnAccount(await signUp(email))
    const returning = await insertUser(email)
    const locked = createDeferred<void>()
    const release = createDeferred<void>()
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE deleted_account_identity IN ACCESS EXCLUSIVE MODE`)
      locked.resolve()
      await release.promise
    })
    await locked.promise

    let created: boolean
    try {
      created = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '200ms'`)
        const result = await createUserStatsIfMissing(tx, returning)
        await tx
          .update(userStats)
          .set({ storageUsedBytes: 7 })
          .where(eq(userStats.userId, returning))
        return result
      })
    } finally {
      release.resolve()
      await holder
    }

    expect(created).toBe(true)
    expect(await statsOf(returning)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    const [stored] = await db
      .select({ bytes: userStats.storageUsedBytes })
      .from(userStats)
      .where(eq(userStats.userId, returning))
    expect(stored.bytes).toBe(7)
  })

  it('never withholds from a stats-less user’s fallback row for a sign-in linked in a later request', async () => {
    const microsoft = { providerId: 'microsoft', accountId: `ms-${generateId()}` }
    await deleteOwnAccount(await signUp(`ms-gone.${generateId()}@deleted-identity.test`, microsoft))
    const legacy = await insertUser(`legacy.${generateId()}@deleted-identity.test`)
    const laterRequest = {}
    await linkAccount(legacy, microsoft)

    await ensureUserStatsExists(legacy, laterRequest)
    await handleNewSignInAccount({ userId: legacy, ...microsoft }, laterRequest)

    expect(await statsOf(legacy)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })

  it('catches a Google re-signup by its email and never records the Google subject', async () => {
    const email = `google.${generateId()}@deleted-identity.test`
    const google = { providerId: 'google', accountId: `google-${generateId()}` }
    const written = await deleteOwnAccount(await signUp(email, google))

    const sameEmail = await signUp(email, google)
    const newEmail = await signUp(`google-new.${generateId()}@deleted-identity.test`, google)

    expect(written).toHaveLength(1)
    expect(await statsOf(sameEmail)).toEqual({ freeTierEligible: false, limit: 0 })
    expect(await statsOf(newEmail)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
  })

  it('keeps a deleted identity for 30 days from the deletion', async () => {
    const email = `window.${generateId()}@deleted-identity.test`
    const userId = await signUp(email)
    const deletedAt = Date.now()
    const written = await deleteOwnAccount(userId)

    const rows = await db
      .select({ expiresAt: deletedAccountIdentity.expiresAt })
      .from(deletedAccountIdentity)
      .where(inArray(deletedAccountIdentity.identityHash, written))

    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    expect(rows).toHaveLength(1)
    expect(Math.abs(rows[0].expiresAt.getTime() - (deletedAt + thirtyDays))).toBeLessThan(60_000)
  })

  it('never records an unverified email, so its real owner keeps the allowance', async () => {
    const email = `unverified.${generateId()}@deleted-identity.test`
    const github = { providerId: 'github', accountId: `gh-${generateId()}` }
    const squatter = await insertUser(email, { emailVerified: false })
    await linkAccount(squatter, github)
    await handleNewUser(squatter, {})
    const written = await deleteOwnAccount(squatter)

    const owner = await signUp(email)
    const sameGithub = await signUp(`unverified-gh.${generateId()}@deleted-identity.test`, github)

    expect(written).toHaveLength(1)
    expect(await statsOf(owner)).toEqual({ freeTierEligible: true, limit: getFreeTierLimit() })
    expect(await statsOf(sameGithub)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('drains every expired digest on the scheduled purge and keeps live ones', async () => {
    const expired = Array.from({ length: 2_345 }, () => generateRandomHex(64))
    const live = Array.from({ length: 3 }, () => generateRandomHex(64))
    recordedHashes.push(...expired, ...live)
    const past = new Date(Date.now() - 60_000)
    const future = new Date(Date.now() + 60 * 60_000)
    for (let start = 0; start < expired.length; start += 500) {
      await db
        .insert(deletedAccountIdentity)
        .values(
          expired
            .slice(start, start + 500)
            .map((identityHash) => ({ identityHash, expiresAt: past }))
        )
    }
    await db
      .insert(deletedAccountIdentity)
      .values(live.map((identityHash) => ({ identityHash, expiresAt: future })))

    const result = await purgeExpiredDeletedAccountIdentities()

    const remaining = await db
      .select({ hash: deletedAccountIdentity.identityHash })
      .from(deletedAccountIdentity)
      .where(inArray(deletedAccountIdentity.identityHash, [...expired, ...live]))
    expect(result.drained).toBe(true)
    expect(result.deleted).toBeGreaterThanOrEqual(expired.length)
    expect(remaining.map((row) => row.hash).sort()).toEqual([...live].sort())
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
