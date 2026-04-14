import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { ensureUserInOrganization } from '@/lib/billing/organizations/membership'
import { generateId } from '@/lib/core/utils/uuid'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

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

interface AttachOwnedWorkspacesToOrganizationParams {
  ownerUserId: string
  organizationId: string
}

export async function getOrganizationWorkspaceBillingUserId(
  organizationId: string,
  fallbackUserId: string
): Promise<string> {
  const organizationOwnerId = await getOrganizationOwnerId(organizationId)
  return organizationOwnerId ?? fallbackUserId
}

export async function attachOwnedWorkspacesToOrganization({
  ownerUserId,
  organizationId,
}: AttachOwnedWorkspacesToOrganizationParams): Promise<AttachOwnedWorkspacesToOrganizationResult> {
  const ownedWorkspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, ownerUserId))

  const billedAccountUserId = await getOrganizationWorkspaceBillingUserId(
    organizationId,
    ownerUserId
  )
  const attachedWorkspaceIds: string[] = []

  for (const ownedWorkspace of ownedWorkspaces) {
    await db
      .update(workspace)
      .set({
        organizationId,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        billedAccountUserId,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, ownedWorkspace.id))

    await ensureWorkspaceAdminPermission(ownedWorkspace.id, billedAccountUserId)
    attachedWorkspaceIds.push(ownedWorkspace.id)
  }

  const uniqueWorkspaceMemberIds = await getWorkspaceMemberIds(attachedWorkspaceIds)
  const addedMemberIds: string[] = []
  const skippedMembers: Array<{ userId: string; reason: string }> = []

  for (const userId of uniqueWorkspaceMemberIds) {
    const result = await ensureUserInOrganization({
      userId,
      organizationId,
      role: userId === billedAccountUserId ? 'owner' : 'member',
      skipSeatValidation: true,
    })

    if (!result.success) {
      skippedMembers.push({
        userId,
        reason: result.error || 'Failed to sync user into organization',
      })
      continue
    }

    if (!result.alreadyMember) {
      addedMemberIds.push(userId)
      await syncUsageLimitsFromSubscription(userId)
    }
  }

  logger.info('Attached owned workspaces to organization', {
    ownerUserId,
    organizationId,
    attachedWorkspaceCount: attachedWorkspaceIds.length,
    addedMemberCount: addedMemberIds.length,
    skippedMemberCount: skippedMembers.length,
  })

  return {
    attachedWorkspaceIds,
    addedMemberIds,
    skippedMembers,
  }
}

export async function detachOrganizationWorkspaces(
  organizationId: string
): Promise<DetachOrganizationWorkspacesResult> {
  const organizationOwnerId = await getOrganizationOwnerId(organizationId)
  const organizationWorkspaces = await db
    .select({ id: workspace.id, ownerId: workspace.ownerId })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION)
      )
    )

  const detachedWorkspaceIds: string[] = []

  for (const organizationWorkspace of organizationWorkspaces) {
    const billedAccountUserId = organizationOwnerId ?? organizationWorkspace.ownerId

    await db
      .update(workspace)
      .set({
        organizationId: null,
        workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
        billedAccountUserId,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, organizationWorkspace.id))

    await ensureWorkspaceAdminPermission(organizationWorkspace.id, billedAccountUserId)
    detachedWorkspaceIds.push(organizationWorkspace.id)
  }

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

export async function ensureWorkspaceAdminPermission(
  workspaceId: string,
  userId: string
): Promise<void> {
  await db
    .insert(permissions)
    .values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [permissions.userId, permissions.entityType, permissions.entityId],
      set: {
        permissionType: 'admin',
        updatedAt: new Date(),
      },
    })
}

async function getOrganizationOwnerId(organizationId: string): Promise<string | null> {
  const [ownerMembership] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  return ownerMembership?.userId ?? null
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
