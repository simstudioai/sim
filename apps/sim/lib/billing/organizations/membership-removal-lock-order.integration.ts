import { db } from '@sim/db'
import { member, organization, permissions, user, workspace } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { lockWorkspaceStorageForMutationInTx } from '@/lib/billing/storage/tracking'

readTestDatabaseUrl()

const userIds: string[] = []
const workspaceIds: string[] = []
const organizationIds: string[] = []

afterAll(async () => {
  if (workspaceIds.length) await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  if (organizationIds.length)
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
})

describe('organization member removal lock order', () => {
  it('does not deadlock with a storage writer that holds a workspace row and then locks its organization payer', async () => {
    const ownerId = generateId()
    const departingId = generateId()
    const organizationId = generateId()
    const workspaceId = generateId()
    userIds.push(ownerId, departingId)
    organizationIds.push(organizationId)
    workspaceIds.push(workspaceId)

    await db.insert(user).values(
      [ownerId, departingId].map((id) => ({
        id,
        name: 'Lock order fixture',
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Lock order', slug: organizationId })
    const memberId = generateId()
    await db.insert(member).values([
      { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: new Date() },
      { id: memberId, organizationId, userId: departingId, role: 'member', createdAt: new Date() },
    ])
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Lock order',
      ownerId,
      billedAccountUserId: ownerId,
      organizationId,
      workspaceMode: 'organization',
    })
    await db.insert(permissions).values(
      [ownerId, departingId].map((userId) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'admin' as const,
      }))
    )

    // The storage writer's order: the workspace row, then the organization payer row.
    const holdingWorkspace = createDeferred<number>()
    const removalBlocked = createDeferred<void>()
    const writer = db.transaction(async (tx) => {
      await lockWorkspaceStorageForMutationInTx(tx, workspaceId)
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      holdingWorkspace.resolve(connection.pid)
      await removalBlocked.promise
      await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for('no key update')
    })

    const writerPid = await holdingWorkspace.promise
    const removal = removeUserFromOrganization({
      organizationId,
      userId: departingId,
      memberId,
      skipBillingLogic: true,
      onError: 'throw',
    })
    try {
      await expect
        .poll(
          async () =>
            (
              await db.execute(
                sql`SELECT pid FROM pg_stat_activity WHERE ${writerPid} = ANY(pg_blocking_pids(pid))`
              )
            ).length,
          { timeout: 10_000 }
        )
        .toBeGreaterThan(0)
    } finally {
      removalBlocked.resolve()
    }

    const [writerOutcome, removalOutcome] = await Promise.allSettled([writer, removal])
    expect(writerOutcome).toEqual({ status: 'fulfilled', value: undefined })
    expect(removalOutcome).toMatchObject({ status: 'fulfilled', value: { success: true } })
    expect(await db.select({ id: member.id }).from(member).where(eq(member.id, memberId))).toEqual(
      []
    )
  })
})
