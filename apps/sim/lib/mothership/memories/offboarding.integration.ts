import { db } from '@sim/db'
import { member, organization, outboxEvent, permissions, user, workspace } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'

readTestDatabaseUrl()

const ownerId = generateId()
const memberId = generateId()
const externalId = generateId()
const organizationId = generateId()
const membershipId = generateId()
const workspaceId = generateId()
let runtime: {
  membership: typeof import('@/lib/billing/organizations/membership')
  resources: typeof import('@/lib/organizations/resource-cleanup')
  event: typeof import('@/lib/mothership/memories/cleanup-event')
}

beforeAll(async () => {
  // The cleanup outbox reads its worker credential and destination when it loads.
  process.env.SIM_AGENT_API_URL = 'http://127.0.0.1:9'
  process.env.COPILOT_API_KEY = 'memory-offboarding-fixture-key'
  const [membership, resources, event] = await Promise.all([
    import('@/lib/billing/organizations/membership'),
    import('@/lib/organizations/resource-cleanup'),
    import('@/lib/mothership/memories/cleanup-event'),
  ])
  runtime = { membership, resources, event }
  await db.insert(user).values(
    [ownerId, memberId, externalId].map((id) => ({
      id,
      name: 'Offboarding fixture',
      email: `${id}@memory.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Offboarding', slug: organizationId })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: new Date() },
    { id: membershipId, organizationId, userId: memberId, role: 'member', createdAt: new Date() },
  ])
  // The external collaborator works in one of the organization's workspaces without membership.
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Offboarding',
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: externalId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'write',
  })
}, 60_000)

afterAll(async () => {
  await db
    .delete(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, runtime.event.MEMORY_CLEANUP_EVENT),
        sql`${outboxEvent.payload}->'request'->'target'->>'organizationId' = ${organizationId}`
      )
    )
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, memberId, externalId]))
})

/** The memory erasures queued for this organization, as `kind:userId` (or `kind`). */
async function queued(): Promise<string[]> {
  const rows = await db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, runtime.event.MEMORY_CLEANUP_EVENT),
        sql`${outboxEvent.payload}->'request'->'target'->>'organizationId' = ${organizationId}`
      )
    )
  return rows
    .map(({ payload }) => {
      const target = (payload as { request: { target: { kind: string; userId?: string } } }).request
        .target
      return target.userId ? `${target.kind}:${target.userId}` : target.kind
    })
    .sort()
}

it('queues private memory erasure with each committed departure and organization deletion, never on rollback', async () => {
  // A removal whose actor lacks authority rolls back with nothing queued.
  await expect(
    runtime.membership.removeUserFromOrganization({
      organizationId,
      userId: memberId,
      memberId: membershipId,
      actorUserId: externalId,
      skipBillingLogic: true,
      onError: 'throw',
    })
  ).rejects.toThrow()
  expect(await queued()).toEqual([])

  await runtime.membership.removeUserFromOrganization({
    organizationId,
    userId: memberId,
    memberId: membershipId,
    skipBillingLogic: true,
    onError: 'throw',
  })
  expect(
    await runtime.membership.removeExternalUserFromOrganizationWorkspaces({
      organizationId,
      userId: externalId,
    })
  ).toMatchObject({ success: true, workspaceAccessRevoked: 1 })
  expect(await queued()).toEqual(
    [`organization_member:${externalId}`, `organization_member:${memberId}`].sort()
  )

  // Organization deletion queues the erasure in the delete transaction: a rollback drops it.
  await expect(
    db.transaction(async (tx) => {
      await runtime.resources.enqueueOrganizationResourceCleanup(tx, organizationId)
      throw new Error('rollback fixture')
    })
  ).rejects.toThrow('rollback fixture')
  expect(await queued()).not.toContain('organization')
  await db.transaction(async (tx) => {
    await runtime.resources.enqueueOrganizationResourceCleanup(tx, organizationId)
  })
  expect(await queued()).toContain('organization')
}, 30_000)
