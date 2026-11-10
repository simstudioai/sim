/**
 * Enterprise owner claim acceptance against real PostgreSQL. Failure mode: acceptance took the
 * owner's billing-identity lock before the lock of the personal organization it converts, the
 * reverse of workspace creation in that organization, so the two could deadlock.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  outboxEvent,
  project,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

// The activation it hands off provisions Stripe; acceptance's own transaction is what is under test.
vi.mock('@/lib/core/outbox/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/outbox/service')>()),
  processOutboxEventById: vi.fn(),
}))

import { acceptEnterpriseOwnerClaim } from '@/lib/billing/enterprise-owner-claim'
import { ENTERPRISE_OWNER_CLAIM_EVENT_TYPE } from '@/lib/billing/enterprise-owner-claim-events'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/identity-lock'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { tryAcquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createDefaultPersonalWorkspaceInTransaction } from '@/lib/workspaces/create'

const userIds: string[] = []
const outboxIds: string[] = []

afterAll(async () => {
  if (outboxIds.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, outboxIds))
  if (userIds.length === 0) return
  const workspaces = await db
    .select({ projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  await db.delete(workspace).where(inArray(workspace.ownerId, userIds))
  const projectIds = workspaces.flatMap((row) => (row.projectId ? [row.projectId] : []))
  if (projectIds.length) await db.delete(project).where(inArray(project.id, projectIds))
  const organizationIds = memberships.map((row) => row.organizationId)
  if (organizationIds.length) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('accepting an Enterprise owner claim', () => {
  it('takes the personal organization lock before the owner billing identity', async () => {
    const userId = `claim-owner-${generateId()}`
    const email = `${userId}@claim-owner.test`
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Claim Owner',
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(userStats).values({ id: generateId(), userId, storageUsedBytes: 0 })
    userIds.push(userId)
    const personalOrganizationId = await createPersonalOrganization(userId)
    if (!personalOrganizationId) throw new Error('expected a personal organization')
    const ownedWorkspace = await db.transaction((tx) =>
      createDefaultPersonalWorkspaceInTransaction(tx, {
        userId,
        userName: 'Claim Owner',
        personalOrganizationId,
      })
    )
    const claimId = generateId()
    const token = generateId()
    outboxIds.push(claimId)
    await enqueueOutboxEvent(
      db,
      ENTERPRISE_OWNER_CLAIM_EVENT_TYPE,
      {
        version: 1,
        request: {
          requestKey: generateId(),
          ownerEmail: email,
          organizationName: 'Claimed Enterprise',
          requestedByEmail: 'admin-api',
          requestedByUserId: null,
          requestedByName: 'Admin Panel',
          invoiceAmountCents: 100_000,
          billingInterval: 'month',
          invitations: [],
          usageLimitCredits: 0,
          seats: 5,
          pausePaymentCollection: false,
        },
        token,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      { id: claimId }
    )

    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const pending: Promise<unknown>[] = []
    try {
      // Workspace creation in the personal organization holds its lock, then wants the identity.
      const creation = db.transaction(async (tx) => {
        await acquireOrganizationMutationLock(tx, personalOrganizationId)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
      })
      pending.push(creation)
      void creation.catch((error: unknown) => held.reject(error))
      const blockerPid = await held.promise
      const acceptance = acceptEnterpriseOwnerClaim({
        claimId,
        token,
        userId,
        userEmail: email,
        userName: 'Claim Owner',
        disclosedWorkspaceIds: [ownedWorkspace.id],
        disclosedCreatesDefaultWorkspace: false,
      })
      pending.push(acceptance)
      await vi.waitFor(
        async () => {
          const [waiting] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event = 'advisory'
              AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
          `)
          expect(waiting).toBeDefined()
        },
        { timeout: 5_000, interval: 25 }
      )

      // While acceptance queues on the personal organization, it must not hold the identity.
      const identityFree = await db.transaction((tx) =>
        tryAcquireAdvisoryXactLock(tx, 'user_billing_identity', `user-billing-identity:${userId}`)
      )
      expect(identityFree).toBe(true)

      release.resolve()
      await creation
      await expect(acceptance).resolves.toMatchObject({ success: true })
    } finally {
      release.resolve()
      await Promise.allSettled(pending)
      const activations = await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload} ->> 'claimId' = ${claimId}`)
      outboxIds.push(...activations.map((row) => row.id))
    }
  })
})
