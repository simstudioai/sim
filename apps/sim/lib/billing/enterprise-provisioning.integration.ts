/**
 * Enterprise issuance for an owner in their personal organization, against real PostgreSQL.
 * Failure mode: issuance took the personal organization's lock before the advisory locks of its
 * workspaces, the reverse of an invitation acceptance or a join's retirement, which take those
 * first, so the two could deadlock.
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
import { afterAll, describe, expect, it } from 'vitest'
import { issueEnterpriseProvisioning } from '@/lib/billing/enterprise-provisioning'
import { tryAcquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createDefaultPersonalWorkspaceInTransaction } from '@/lib/workspaces/create'

const userIds: string[] = []

afterAll(async () => {
  if (userIds.length === 0) return
  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  const organizationIds = memberships.map((row) => row.organizationId)
  if (organizationIds.length) {
    await db
      .delete(outboxEvent)
      .where(
        sql`${outboxEvent.payload} #>> '{request,organizationId}' = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(organizationIds)}::jsonb)))`
      )
  }
  const workspaces = await db
    .select({ projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
  await db.delete(workspace).where(inArray(workspace.ownerId, userIds))
  const projectIds = workspaces.flatMap((row) => (row.projectId ? [row.projectId] : []))
  if (projectIds.length) await db.delete(project).where(inArray(project.id, projectIds))
  if (organizationIds.length) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('issuing Enterprise to an owner in their personal organization', () => {
  it('takes the personal organization’s workspace locks before its organization lock', async () => {
    const userId = `issuance-owner-${generateId()}`
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Issuance Owner',
      email: `${userId}@issuance-owner.test`,
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
        userName: 'Issuance Owner',
        personalOrganizationId,
      })
    )

    const held = createDeferred<number>()
    const release = createDeferred<void>()
    const pending: Promise<unknown>[] = []
    try {
      // An acceptance or a join holds the workspace's advisory lock, then wants the organization.
      const acceptance = db.transaction(async (tx) => {
        await acquireInvitationMutationLocks(tx, {
          invitationIds: [],
          workspaceIds: [ownedWorkspace.id],
        })
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        held.resolve(connection.pid)
        await release.promise
      })
      pending.push(acceptance)
      void acceptance.catch((error: unknown) => held.reject(error))
      const blockerPid = await held.promise
      const issuance = issueEnterpriseProvisioning({
        ownerUserId: userId,
        organizationName: 'Issued Enterprise',
        invoiceAmountUsd: 1_000,
        seats: 5,
        requestedByEmail: 'admin-api',
        requestedByUserId: null,
      })
      pending.push(issuance)
      await expect
        .poll(
          async () => {
            const [waiting] = await db.execute<{ pid: number }>(sql`
              SELECT pid FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event = 'advisory'
                AND ${blockerPid}::int = ANY(pg_blocking_pids(pid))
            `)
            return waiting !== undefined
          },
          { timeout: 4_000, interval: 25 }
        )
        .toBe(true)

      // While issuance queues on the workspace, it must not hold the organization lock.
      const organizationFree = await db.transaction((tx) =>
        tryAcquireAdvisoryXactLock(
          tx,
          'organization_mutation',
          `organization-mutation:${personalOrganizationId}`
        )
      )
      expect(organizationFree).toBe(true)

      release.resolve()
      await acceptance
      await expect(issuance).resolves.toMatchObject({ organizationId: personalOrganizationId })
    } finally {
      release.resolve()
      await Promise.allSettled(pending)
    }
  })
})
