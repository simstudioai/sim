import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  acquireOrganizationMutationLock,
  ensureUserInOrganizationTx,
  reapplyPaidOrgJoinBillingForExistingMemberTx,
} from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { getOrganizationOwnerId, WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('OrganizationWorkspaces')

export interface AttachOwnedWorkspacesToOrganizationResult {
  attachedWorkspaceIds: string[]
  addedMemberIds: string[]
  skippedMembers: Array<{ userId: string; reason: string }>
}

export interface AttachOwnedWorkspacesToOrganizationTxResult
  extends AttachOwnedWorkspacesToOrganizationResult {
  /** These best-effort derived-limit refreshes must run only after commit. */
  usageLimitUserIds: string[]
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

/**
 * How to treat workspace members that already belong to a *different*
 * organization when attaching workspaces:
 *   - `reject` (default): throw a conflict — used by manual org creation.
 *   - `keep-external`: skip them (they stay external workspace members) and
 *     attach anyway — used by the Pro→Team conversion, which must not abort
 *     just because a personal workspace already has an external collaborator.
 */
type ExternalMemberPolicy = 'reject' | 'keep-external'

interface AttachOwnedWorkspacesToOrganizationParams {
  ownerUserId: string
  organizationId: string
  externalMemberPolicy?: ExternalMemberPolicy
}

export async function attachOwnedWorkspacesToOrganization({
  ownerUserId,
  organizationId,
  externalMemberPolicy = 'reject',
}: AttachOwnedWorkspacesToOrganizationParams): Promise<AttachOwnedWorkspacesToOrganizationResult> {
  const ownedWorkspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.ownerId, ownerUserId),
        isNull(workspace.organizationId),
        ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
        isNull(workspace.archivedAt)
      )
    )
  const ownedWorkspaceIds = ownedWorkspaces.map((ownedWorkspace) => ownedWorkspace.id)
  if (ownedWorkspaceIds.length === 0) {
    return { attachedWorkspaceIds: [], addedMemberIds: [], skippedMembers: [] }
  }

  const attached = await db.transaction(async (tx) => {
    // Match admin move and invitation acceptance: workspace/invitation scope
    // first, then organization. Membership and assignment now commit or roll
    // back together, so a concurrent move cannot leave stray org members.
    await acquireInvitationMutationLocks(tx, {
      invitationIds: [],
      workspaceIds: ownedWorkspaceIds,
    })
    await acquireOrganizationMutationLock(tx, organizationId)
    return attachOwnedWorkspacesToOrganizationTx(tx, {
      ownerUserId,
      organizationId,
      workspaceIds: ownedWorkspaceIds,
      externalMemberPolicy,
      ownerMatch: 'owner',
    })
  })

  for (const userId of attached.usageLimitUserIds) {
    try {
      await syncUsageLimitsFromSubscription(userId)
    } catch (error) {
      // Membership and workspace assignment have already committed. This
      // refresh is derived/best-effort; surfacing a failure would invite a
      // misleading retry that finds no remaining candidate workspaces.
      logger.error('Failed to refresh usage limits after workspace attachment', {
        userId,
        organizationId,
        error,
      })
    }
  }

  logger.info('Attached owned workspaces to organization', {
    ownerUserId,
    organizationId,
    attachedWorkspaceCount: attached.attachedWorkspaceIds.length,
    addedMemberCount: attached.addedMemberIds.length,
    skippedMemberCount: attached.skippedMembers.length,
  })

  return {
    attachedWorkspaceIds: attached.attachedWorkspaceIds,
    addedMemberIds: attached.addedMemberIds,
    skippedMembers: attached.skippedMembers,
  }
}

/**
 * Transaction-enlisted Pro→Team conversion path used by invitation
 * acceptance. The caller supplies the exact workspace IDs whose deterministic
 * invitation/workspace advisory locks it already holds. Subscription transfer,
 * organization membership, workspace attachment, owner permission, and
 * billing outbox rows therefore commit or roll back with the invitation.
 *
 * Usage-limit refreshes intentionally remain post-commit; their user IDs are
 * returned to the caller instead of opening the global pool from inside the
 * transaction.
 */
export async function attachOwnedWorkspacesToOrganizationTx(
  tx: DbOrTx,
  {
    ownerUserId,
    organizationId,
    workspaceIds,
    externalMemberPolicy = 'keep-external',
    ownerMatch = 'billing-account',
  }: {
    ownerUserId: string
    organizationId: string
    workspaceIds: string[]
    externalMemberPolicy?: ExternalMemberPolicy
    ownerMatch?: 'owner' | 'billing-account'
  }
): Promise<AttachOwnedWorkspacesToOrganizationTxResult> {
  if (workspaceIds.length === 0) {
    return {
      attachedWorkspaceIds: [],
      addedMemberIds: [],
      skippedMembers: [],
      usageLimitUserIds: [],
    }
  }

  // A workspace may have completed a different organization move while this
  // acceptance was waiting for its advisory locks. Never turn that into an
  // inter-organization transfer: attach only rows that are still non-org.
  const ownedWorkspaces = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        ownerMatch === 'owner'
          ? eq(workspace.ownerId, ownerUserId)
          : eq(workspace.billedAccountUserId, ownerUserId),
        inArray(workspace.id, workspaceIds),
        isNull(workspace.organizationId),
        ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
        isNull(workspace.archivedAt)
      )
    )
    .for('update')

  if (ownedWorkspaces.length === 0) {
    return {
      attachedWorkspaceIds: [],
      addedMemberIds: [],
      skippedMembers: [],
      usageLimitUserIds: [],
    }
  }

  const [ownerMembership] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  if (!ownerMembership) {
    throw new Error(`Organization ${organizationId} has no owner membership`)
  }

  const ownedWorkspaceIds = ownedWorkspaces.map((row) => row.id)
  const permissionRows = await tx
    .select({ userId: permissions.userId })
    .from(permissions)
    .where(
      and(eq(permissions.entityType, 'workspace'), inArray(permissions.entityId, ownedWorkspaceIds))
    )
  const workspaceMemberIds = [...new Set(permissionRows.map((row) => row.userId))].sort()
  const memberships =
    workspaceMemberIds.length > 0
      ? await tx
          .select({ userId: member.userId, organizationId: member.organizationId })
          .from(member)
          .where(inArray(member.userId, workspaceMemberIds))
      : []
  const membershipByUser = new Map(memberships.map((row) => [row.userId, row.organizationId]))
  const skippedMembers = workspaceMemberIds
    .filter((userId) => {
      const currentOrganizationId = membershipByUser.get(userId)
      return currentOrganizationId !== undefined && currentOrganizationId !== organizationId
    })
    .map((userId) => ({
      userId,
      reason: 'Already a member of another organization; kept as external workspace member',
    }))
  if (externalMemberPolicy === 'reject' && skippedMembers.length > 0) {
    throw new WorkspaceOrganizationMembershipConflictError(
      skippedMembers.map(({ userId }) => ({
        userId,
        organizationId: membershipByUser.get(userId) as string,
      }))
    )
  }
  const skippedUserIds = new Set(skippedMembers.map((row) => row.userId))
  const joinableUserIds = workspaceMemberIds.filter((userId) => !skippedUserIds.has(userId))

  const addedMemberIds: string[] = []
  const usageLimitUserIds: string[] = []
  for (const userId of joinableUserIds) {
    const result = await ensureUserInOrganizationTx(tx, {
      userId,
      organizationId,
      role: userId === ownerMembership.userId ? 'owner' : 'member',
      skipSeatValidation: true,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to sync workspace member into organization')
    }
    if (result.alreadyMember) {
      await reapplyPaidOrgJoinBillingForExistingMemberTx(tx, userId, organizationId)
    } else {
      addedMemberIds.push(userId)
      usageLimitUserIds.push(userId)
    }
  }

  const now = new Date()
  const attachedWorkspaceIds: string[] = []
  for (const ownedWorkspace of ownedWorkspaces) {
    const [updatedWorkspace] = await tx
      .update(workspace)
      .set({
        organizationId,
        workspaceMode: WORKSPACE_MODE.ORGANIZATION,
        billedAccountUserId: ownerMembership.userId,
        organizationAssignedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workspace.id, ownedWorkspace.id),
          isNull(workspace.organizationId),
          ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
          isNull(workspace.archivedAt)
        )
      )
      .returning({ id: workspace.id })

    if (!updatedWorkspace) continue

    await tx
      .insert(permissions)
      .values({
        id: generateId(),
        userId: ownerMembership.userId,
        entityType: 'workspace',
        entityId: ownedWorkspace.id,
        permissionType: 'admin',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [permissions.userId, permissions.entityType, permissions.entityId],
        set: { permissionType: 'admin', updatedAt: now },
      })
    attachedWorkspaceIds.push(updatedWorkspace.id)
  }

  return {
    attachedWorkspaceIds,
    addedMemberIds,
    skippedMembers,
    usageLimitUserIds,
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
          organizationAssignedAt: null,
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
