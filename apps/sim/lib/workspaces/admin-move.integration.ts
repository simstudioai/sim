import { db } from '@sim/db'
import {
  customBlock,
  member,
  organization,
  outboxEvent,
  permissions,
  user,
  userStats,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workspace,
} from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId, generateShortId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import {
  getWorkspaceMoveOperation,
  getWorkspaceMovePreflight,
  moveWorkspaceToOrganization,
  type WorkspaceMoveError,
} from '@/lib/workspaces/admin-move'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

readTestDatabaseUrl()

const userIds: string[] = []
const organizationIds: string[] = []
const workspaceIds: string[] = []
const operationIds: string[] = []

async function createUser() {
  const id = generateId()
  userIds.push(id)
  await db.insert(user).values({
    id,
    name: 'Move fixture',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(userStats).values({ id: generateId(), userId: id })
  return id
}

async function createOrganization() {
  const ownerId = await createUser()
  const id = generateId()
  organizationIds.push(id)
  await db.insert(organization).values({ id, name: `Org ${id}`, slug: id, createdAt: new Date() })
  await db
    .insert(member)
    .values({ id: generateId(), organizationId: id, userId: ownerId, role: 'owner' })
  return { id, ownerId }
}

async function createWorkspace(params: {
  ownerId: string
  organization?: { id: string; ownerId: string }
  forkedFromWorkspaceId?: string
}) {
  const id = generateId()
  workspaceIds.push(id)
  await insertWorkspaceFixture(db, {
    id,
    name: `Workspace ${id}`,
    ownerId: params.ownerId,
    organizationId: params.organization?.id ?? null,
    workspaceMode: params.organization ? WORKSPACE_MODE.ORGANIZATION : WORKSPACE_MODE.PERSONAL,
    billedAccountUserId: params.organization?.ownerId ?? params.ownerId,
    forkedFromWorkspaceId: params.forkedFromWorkspaceId ?? null,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: params.ownerId,
    entityType: 'workspace',
    entityId: id,
    permissionType: 'admin',
  })
  return id
}

async function createWorkflow(workspaceId: string, userId: string, isDeployed = false) {
  const id = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId,
    workspaceId,
    name: `Move fixture workflow ${id}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
    isDeployed,
  })
  return id
}

async function publishCustomBlock(organizationId: string, workflowId: string) {
  const id = generateId()
  const type = `custom_block_${generateShortId(10).toLowerCase()}`
  await db
    .insert(customBlock)
    .values({ id, organizationId, workflowId, type, name: `Block ${type}` })
  return { id, type }
}

async function placeBlock(workflowId: string, type: string) {
  await db.insert(workflowBlocks).values({
    id: generateId(),
    workflowId,
    type,
    name: 'Placed custom block',
    positionX: '0',
    positionY: '0',
  })
}

function newOperationId() {
  const id = generateId()
  operationIds.push(id)
  return id
}

async function readWorkspace(id: string) {
  const [row] = await db
    .select({
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(eq(workspace.id, id))
  return row
}

afterAll(async () => {
  if (operationIds.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, operationIds))
  if (workspaceIds.length) {
    await db.delete(permissions).where(inArray(permissions.entityId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  }
  if (organizationIds.length)
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
})

describe('moveWorkspaceToOrganization against PostgreSQL', () => {
  it('moves a personal workspace into an organization and replays the confirmed operation', async () => {
    const ownerId = await createUser()
    const destination = await createOrganization()
    const workspaceId = await createWorkspace({ ownerId })
    const operationId = newOperationId()
    const move = () =>
      moveWorkspaceToOrganization({
        workspaceId,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@example.test',
        expectedOwnerId: ownerId,
        auditOperationId: operationId,
        operationCorrelationId: operationId,
        durableOperationId: operationId,
      })

    const applied = await move()

    expect(applied.workspace).toMatchObject({ id: workspaceId, organizationId: destination.id })
    expect(applied.sourceOrganization).toBeNull()
    expect(await readWorkspace(workspaceId)).toEqual({
      organizationId: destination.id,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      billedAccountUserId: destination.ownerId,
    })
    const destinationOwnerGrant = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(eq(permissions.userId, destination.ownerId))
    expect(destinationOwnerGrant).toEqual([{ permissionType: 'admin' }])
    const [operation] = await db
      .select({ status: outboxEvent.status, payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, operationId))
    expect(operation).toMatchObject({
      status: 'completed',
      payload: { audit: { sourceOrganizationId: null } },
    })

    const replayed = await move()
    expect(replayed.workspace).toMatchObject({ id: workspaceId, organizationId: destination.id })
    expect(
      await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(eq(outboxEvent.id, operationId))
    ).toHaveLength(1)

    await expect(
      moveWorkspaceToOrganization({
        workspaceId,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@example.test',
        expectedOwnerId: ownerId,
        durableOperationId: newOperationId(),
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({ code: 'already-organization-workspace' })

    const reloaded = await getWorkspaceMoveOperation(
      workspaceId,
      destination.id,
      ownerId,
      operationId
    )
    expect(reloaded).toMatchObject({ operationId, sourceOrganization: null })
  })

  it('moves between organizations, unpublishing only blocks bound to the moving workspace', async () => {
    const source = await createOrganization()
    const destination = await createOrganization()
    const workspaceId = await createWorkspace({ ownerId: source.ownerId, organization: source })
    const siblingId = await createWorkspace({ ownerId: source.ownerId, organization: source })
    const movingWorkflow = await createWorkflow(workspaceId, source.ownerId)
    const deployedMovingWorkflow = await createWorkflow(workspaceId, source.ownerId, true)
    const siblingWorkflow = await createWorkflow(siblingId, source.ownerId)
    const outbound = await publishCustomBlock(source.id, movingWorkflow)
    const inbound = await publishCustomBlock(source.id, siblingWorkflow)
    await placeBlock(movingWorkflow, outbound.type)
    await placeBlock(movingWorkflow, inbound.type)
    await db.insert(workflowDeploymentVersion).values({
      id: generateId(),
      workflowId: deployedMovingWorkflow,
      version: 1,
      isActive: true,
      state: { blocks: { placed: { id: 'placed', type: inbound.type } }, edges: [] },
    })

    const preflight = await getWorkspaceMovePreflight(workspaceId, destination.id)

    expect(preflight.blockers).toEqual([])
    expect(preflight.sourceOrganizationImpact.unpublishedCustomBlocks).toEqual([
      expect.objectContaining({ id: outbound.id }),
    ])
    expect(preflight.sourceOrganizationImpact.inboundCustomBlocks).toEqual([
      expect.objectContaining({ id: inbound.id, movingWorkspaceUsage: { live: 2, deployed: 1 } }),
    ])
    expect(preflight.notices).toContainEqual(expect.stringContaining('will stop resolving'))

    const operationId = newOperationId()
    const move = () =>
      moveWorkspaceToOrganization({
        workspaceId,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@example.test',
        auditOperationId: operationId,
        operationCorrelationId: operationId,
        durableOperationId: operationId,
      })

    const applied = await move()

    expect(applied.sourceOrganization?.id).toBe(source.id)
    expect(applied.sourceOrganizationImpact.unpublishedCustomBlocks.map(({ id }) => id)).toEqual([
      outbound.id,
    ])
    expect(await readWorkspace(workspaceId)).toEqual({
      organizationId: destination.id,
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      billedAccountUserId: destination.ownerId,
    })
    const remainingBlocks = await db
      .select({ id: customBlock.id })
      .from(customBlock)
      .where(inArray(customBlock.id, [outbound.id, inbound.id]))
    expect(remainingBlocks).toEqual([{ id: inbound.id }])

    const replayed = await move()
    expect(replayed.sourceOrganization?.id).toBe(source.id)
    expect(replayed.sourceOrganizationImpact.unpublishedCustomBlocks.map(({ id }) => id)).toEqual([
      outbound.id,
    ])
  })

  it('refuses a move that would split a fork lineage across organizations', async () => {
    const source = await createOrganization()
    const destination = await createOrganization()
    const parentId = await createWorkspace({ ownerId: source.ownerId, organization: source })
    const childId = await createWorkspace({
      ownerId: source.ownerId,
      organization: source,
      forkedFromWorkspaceId: parentId,
    })
    const operationId = newOperationId()

    await expect(
      moveWorkspaceToOrganization({
        workspaceId: childId,
        destinationOrganizationId: destination.id,
        adminEmail: 'admin@example.test',
        durableOperationId: operationId,
      })
    ).rejects.toMatchObject<Partial<WorkspaceMoveError>>({ code: 'fork-lineage-conflict' })

    expect(await readWorkspace(childId)).toMatchObject({ organizationId: source.id })
    expect(
      await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(eq(outboxEvent.id, operationId))
    ).toEqual([])
  })
})
