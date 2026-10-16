/**
 * Deleting your own account and signing up again must not reset the one-time free allowance,
 * and must not leave the account's workflow runs spending after it is gone. Runs against real
 * PostgreSQL through the production deletion, signup-stats, plan-sync, and cancellation paths.
 */
import { db } from '@sim/db'
import {
  account,
  deletedAccountIdentity,
  permissions,
  user,
  userStats,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  forfeitFreeTierAllowance,
  handleNewUser,
  syncUsageLimitsFromSubscription,
} from '@/lib/billing/core/usage'
import { getFreeTierLimit } from '@/lib/billing/subscriptions/utils'
import { subscribeToExecutionCancellation } from '@/lib/execution/cancellation'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { isDeletedAccountIdentity } from '@/lib/users/deleted-identity'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))
vi.mock('@/lib/auth', () => authMock)

const userIds: string[] = []
const workspaceIds: string[] = []
const recordedHashes: string[] = []

/** Creates a user the way signup does: the row, then `handleNewUser` from `user.create.after`. */
async function signUp(email: string): Promise<string> {
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
  await handleNewUser({ id, email })
  return id
}

async function linkAccount(userId: string, providerId: string, accountId: string) {
  const now = new Date()
  await db
    .insert(account)
    .values({ id: generateId(), userId, providerId, accountId, createdAt: now, updatedAt: now })
}

async function seedWorkspace(ownerId: string): Promise<string> {
  const id = generateId()
  workspaceIds.push(id)
  await insertWorkspaceFixture(db, {
    id,
    name: 'Deleted identity fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: id,
    permissionType: 'admin',
  })
  return id
}

/** A workflow in the workspace with one run still executing. */
async function seedRunningExecution(ownerId: string, workspaceId: string): Promise<string> {
  const workflowId = generateId()
  const snapshotId = generateId()
  const executionId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Deleted identity fixture',
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(workflowExecutionSnapshots)
    .values({ id: snapshotId, workflowId, stateHash: snapshotId, stateData: {} })
  await db.insert(workflowExecutionLogs).values({
    id: generateId(),
    workflowId,
    workspaceId,
    executionId,
    stateSnapshotId: snapshotId,
    level: 'info',
    status: 'running',
    trigger: 'api',
    startedAt: now,
    executionData: {},
  })
  return executionId
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
  if (workspaceIds.length) {
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
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

  it('recognises a returning GitHub identity whose primary email changed', async () => {
    const githubSubject = `gh-${generateId()}`
    const original = await signUp(`gh-old.${generateId()}@deleted-identity.test`)
    await linkAccount(original, 'github', githubSubject)
    await deleteOwnAccount(original)
    const returning = await signUp(`gh-new.${generateId()}@deleted-identity.test`)
    expect((await statsOf(returning)).freeTierEligible).toBe(true)

    const matched = await isDeletedAccountIdentity({
      oauthSubjects: [{ providerId: 'github', accountId: githubSubject }],
    })
    await forfeitFreeTierAllowance(returning)

    expect(matched).toBe(true)
    expect(await statsOf(returning)).toEqual({ freeTierEligible: false, limit: 0 })
  })

  it('records only sign-in identities, as keyed digests holding no address or subject', async () => {
    const email = `digest.${generateId()}@deleted-identity.test`
    const githubSubject = `gh-${generateId()}`
    const userId = await signUp(email)
    await linkAccount(userId, 'github', githubSubject)
    await linkAccount(userId, 'slack', `T1-U1-${generateId()}`)

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

describe('deleting an account stops its running workflows', () => {
  it('cancels runs in the workspaces it erases and leaves everyone else’s running', async () => {
    const departing = await signUp(`runs.${generateId()}@deleted-identity.test`)
    const bystander = await signUp(`bystander.${generateId()}@deleted-identity.test`)
    const doomedRun = await seedRunningExecution(departing, await seedWorkspace(departing))
    const otherRun = await seedRunningExecution(bystander, await seedWorkspace(bystander))
    const cancelled = new Set<string>()
    const unsubscribers = await Promise.all(
      [doomedRun, otherRun].map((executionId) =>
        subscribeToExecutionCancellation(executionId, () => cancelled.add(executionId))
      )
    )

    try {
      await deleteOwnAccount(departing)

      await expect.poll(() => cancelled.has(doomedRun)).toBe(true)
      expect(cancelled.has(otherRun)).toBe(false)
    } finally {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  })
})
