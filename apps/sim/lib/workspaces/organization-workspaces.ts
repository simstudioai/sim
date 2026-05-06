import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  ensureUserInOrganization,
  reapplyPaidOrgJoinBillingForExistingMember,
} from '@/lib/billing/organizations/membership'
import { getOrganizationOwnerId, WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('OrganizationWorkspaces')

export interface AttachOwnedWorkspacesToOrganizationResult {
  attachedWorkspaceIds: string[]
  addedMemberIds: string[]
  skippedMembers: Array<{ userId: string; reason: string }>
}

export interface DetachOrganizationWorkspacesResult {
  detachedWorkspaceIds: string[]
  billedAccountUserId: string | null
}

export class WorkspaceOrganizationMembershipConflictError extends Error {
  conflicts: Array<{ userId: string; organizationId: string }>

  constructor(conflicts: Array<{ userId: string; organizationId: string }>) {
    super(
      'One or more workspace members already belong to another organization and cannot be attached.'
    )
    this.name = 'WorkspaceOrganizationMembershipConflictError'
    this.conflicts = conflicts
  }
}

interface AttachOwnedWorkspacesToOrganizationParams {
  ownerUserId: string
  organizationId: string
}

export async function attachOwnedWorkspacesToOrganization({
  ownerUserId,
  organizationId,
}: AttachOwnedWorkspacesToOrganizationParams): Promise<AttachOwnedWorkspacesToOrganizationResult> {
  const ownedWorkspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, ownerUserId))

  const billedAccountUserId = await getOrganizationOwnerId(organizationId)
  if (!billedAccountUserId) {
    logger.error('Attempted to attach workspaces to an organization without an owner', {
      organizationId,
      ownerUserId,
    })
    throw new Error(`Organization ${organizationId} has no owner membership`)
  }
  const ownedWorkspaceIds = ownedWorkspaces.map((ownedWorkspace) => ownedWorkspace.id)
  const uniqueWorkspaceMemberIds = await getWorkspaceMemberIds(ownedWorkspaceIds)
  await assertWorkspaceMembersCanJoinOrganization(uniqueWorkspaceMemberIds, organizationId)

  const addedMemberIds: string[] = []

  for (const userId of uniqueWorkspaceMemberIds) {
    const result = await ensureUserInOrganization({
      userId,
      organizationId,
      role: userId === billedAccountUserId ? 'owner' : 'member',
      skipSeatValidation: true,
    })

    if (!result.success) {
      logger.error('Failed to sync workspace member into organization before attachment', {
        userId,
        organizationId,
        ownerUserId,
        error: result.error,
      })
      throw new Error(result.error || 'Failed to sync workspace member into organization')
    }

    if (result.alreadyMember) {
      await reapplyPaidOrgJoinBillingForExistingMember(userId, organizationId)
    } else {
      addedMemberIds.push(userId)
      await syncUsageLimitsFromSubscription(userId)
    }
  }

  const attachedWorkspaceIds = await db.transaction(async (tx) => {
    const touched: string[] = []
    const now = new Date()

    for (const ownedWorkspace of ownedWorkspaces) {
      await tx
        .update(workspace)
        .set({
          organizationId,
          workspaceMode: WORKSPACE_MODE.ORGANIZATION,
          billedAccountUserId,
          updatedAt: now,
        })
        .where(eq(workspace.id, ownedWorkspace.id))

      await tx
        .insert(permissions)
        .values({
          id: generateId(),
          userId: billedAccountUserId,
          entityType: 'workspace',
          entityId: ownedWorkspace.id,
          permissionType: 'admin',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [permissions.userId, permissions.entityType, permissions.entityId],
          set: {
            permissionType: 'admin',
            updatedAt: now,
          },
        })

      touched.push(ownedWorkspace.id)
    }

    return touched
  })

  logger.info('Attached owned workspaces to organization', {
    ownerUserId,
    organizationId,
    attachedWorkspaceCount: attachedWorkspaceIds.length,
    addedMemberCount: addedMemberIds.length,
  })

  return {
    attachedWorkspaceIds,
    addedMemberIds,
    skippedMembers: [],
  }
}

export async function detachOrganizationWorkspaces(
  organizationId: string
): Promise<DetachOrganizationWorkspacesResult> {
  const organizationOwnerId = await getOrganizationOwnerId(organizationId)
  if (!organizationOwnerId) {
    logger.warn(
      'Detaching workspaces from an organization without an owner; using workspace owner as billed account',
      { organizationId }
    )
  }

  const organizationWorkspaces = await db
    .select({ id: workspace.id, ownerId: workspace.ownerId })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION)
      )
    )

  const detachedWorkspaceIds = await db.transaction(async (tx) => {
    const touched: string[] = []
    const now = new Date()

    for (const organizationWorkspace of organizationWorkspaces) {
      const billedAccountUserId = organizationOwnerId ?? organizationWorkspace.ownerId

      await tx
        .update(workspace)
        .set({
          organizationId: null,
          workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
          billedAccountUserId,
          updatedAt: now,
        })
        .where(eq(workspace.id, organizationWorkspace.id))

      await tx
        .insert(permissions)
        .values({
          id: generateId(),
          userId: billedAccountUserId,
          entityType: 'workspace',
          entityId: organizationWorkspace.id,
          permissionType: 'admin',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [permissions.userId, permissions.entityType, permissions.entityId],
          set: {
            permissionType: 'admin',
            updatedAt: now,
          },
        })

      touched.push(organizationWorkspace.id)
    }

    return touched
  })

  logger.info('Detached organization workspaces', {
    organizationId,
    detachedWorkspaceCount: detachedWorkspaceIds.length,
    billedAccountUserId: organizationOwnerId,
  })

  return {
    detachedWorkspaceIds,
    billedAccountUserId: organizationOwnerId,
  }
}

async function assertWorkspaceMembersCanJoinOrganization(
  userIds: string[],
  organizationId: string
): Promise<void> {
  if (userIds.length === 0) {
    return
  }

  const memberships = await db
    .select({
      userId: member.userId,
      organizationId: member.organizationId,
    })
    .from(member)
    .where(inArray(member.userId, userIds))

  const conflicts = memberships.filter((membership) => membership.organizationId !== organizationId)

  if (conflicts.length === 0) {
    return
  }

  logger.warn('Workspace attachment blocked by members in another organization', {
    organizationId,
    conflictCount: conflicts.length,
    conflictingUserIds: conflicts.map((conflict) => conflict.userId),
  })

  throw new WorkspaceOrganizationMembershipConflictError(conflicts)
}

async function getWorkspaceMemberIds(workspaceIds: string[]): Promise<string[]> {
  if (workspaceIds.length === 0) {
    return []
  }

  const rows = await db
    .select({ userId: permissions.userId })
    .from(permissions)
    .where(
      and(eq(permissions.entityType, 'workspace'), inArray(permissions.entityId, workspaceIds))
    )

  return [...new Set(rows.map((row) => row.userId))]
}
