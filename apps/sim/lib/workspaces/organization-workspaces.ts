import { AuditAction, AuditResourceType, recordAuditBatch } from '@sim/audit'
import { db } from '@sim/db'
import { member, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  acquireOrganizationMutationLock,
  ensureUserInOrganizationTx,
  reapplyPaidOrgJoinBillingForExistingMemberTx,
} from '@/lib/billing/organizations/membership'
import { changeWorkspaceStoragePayersInTx } from '@/lib/billing/storage/payer-transfer'
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
 * How to treat workspace collaborators that are not members of the target
 * organization when attaching workspaces:
 *   - `reject` (default): throw a conflict when any collaborator belongs to a
 *     *different* organization — used by manual org creation.
 *   - `keep-external`: collaborators in a *different* organization stay
 *     external workspace members and the attach proceeds; org-less
 *     collaborators are joined into the organization — used by the Pro→Team
 *     conversion, which must not abort just because a personal workspace
 *     already has an external collaborator.
 *   - `external-all`: nobody joins the organization as a side effect — every
 *     collaborator who is not already a member stays an external workspace
 *     member. Used when a joining member's owned workspaces follow them into
 *     the organization: membership (and its seat) only ever comes from an
 *     invitation the person accepted or an explicit admin action.
 */
type ExternalMemberPolicy = 'reject' | 'keep-external' | 'external-all'

/**
 * The single definition of "a workspace that follows this user into an
 * organization": owned (or billed) by them, not yet organization-owned, and —
 * unless `includeArchived` — not archived. Every site that selects, locks, or
 * previews attachable workspaces must build its WHERE from this so the
 * acceptance lock plan, the attach queries, and the accept-screen preview can
 * never drift apart.
 */
export function ownedAttachableWorkspacesWhere({
  userId,
  ownerMatch = 'owner',
  includeArchived = false,
}: {
  userId: string
  ownerMatch?: 'owner' | 'billing-account'
  includeArchived?: boolean
}) {
  return and(
    ownerMatch === 'owner'
      ? eq(workspace.ownerId, userId)
      : eq(workspace.billedAccountUserId, userId),
    isNull(workspace.organizationId),
    ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
    ...(includeArchived ? [] : [isNull(workspace.archivedAt)])
  )
}

/**
 * Locks workspace rows before any membership billing path can lock user or
 * organization payer rows.
 */
async function lockWorkspaceRowsForPayerChanges(tx: DbOrTx, workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0) return
  await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(inArray(workspace.id, [...workspaceIds].sort()))
    .orderBy(asc(workspace.id))
    .for('update')
}

interface AttachOwnedWorkspacesToOrganizationParams {
  ownerUserId: string
  organizationId: string
  externalMemberPolicy?: ExternalMemberPolicy
  /**
   * Also attach archived workspaces. Join-attach sweeps them so unarchiving
   * later can never resurface a personal workspace outside the organization.
   */
  includeArchived?: boolean
}

export async function attachOwnedWorkspacesToOrganization({
  ownerUserId,
  organizationId,
  externalMemberPolicy = 'reject',
  includeArchived = false,
}: AttachOwnedWorkspacesToOrganizationParams): Promise<AttachOwnedWorkspacesToOrganizationResult> {
  const ownedWorkspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(ownedAttachableWorkspacesWhere({ userId: ownerUserId, includeArchived }))
  const ownedWorkspaceIds = ownedWorkspaces.map((ownedWorkspace) => ownedWorkspace.id)
  if (ownedWorkspaceIds.length === 0) {
    return { attachedWorkspaceIds: [], addedMemberIds: [], skippedMembers: [] }
  }

  const attached = await db.transaction(async (tx) => {
    await lockWorkspaceRowsForPayerChanges(tx, ownedWorkspaceIds)
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
      includeArchived,
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
    includeArchived = false,
  }: {
    ownerUserId: string
    organizationId: string
    workspaceIds: string[]
    externalMemberPolicy?: ExternalMemberPolicy
    ownerMatch?: 'owner' | 'billing-account'
    includeArchived?: boolean
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
    .select({
      id: workspace.id,
      billedAccountUserId: workspace.billedAccountUserId,
      organizationId: workspace.organizationId,
    })
    .from(workspace)
    .where(
      and(
        ownedAttachableWorkspacesWhere({ userId: ownerUserId, ownerMatch, includeArchived }),
        inArray(workspace.id, workspaceIds)
      )
    )
    .orderBy(asc(workspace.id))
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
  const differentOrgMembers = workspaceMemberIds.filter((userId) => {
    const currentOrganizationId = membershipByUser.get(userId)
    return currentOrganizationId !== undefined && currentOrganizationId !== organizationId
  })
  if (externalMemberPolicy === 'reject' && differentOrgMembers.length > 0) {
    throw new WorkspaceOrganizationMembershipConflictError(
      differentOrgMembers.map((userId) => ({
        userId,
        organizationId: membershipByUser.get(userId) as string,
      }))
    )
  }
  const skippedMembers: Array<{ userId: string; reason: string }> = differentOrgMembers.map(
    (userId) => ({
      userId,
      reason: 'Already a member of another organization; kept as external workspace member',
    })
  )
  if (externalMemberPolicy === 'external-all') {
    for (const userId of workspaceMemberIds) {
      if (membershipByUser.get(userId) === undefined) {
        skippedMembers.push({
          userId,
          reason: 'Not an organization member; kept as external workspace member',
        })
      }
    }
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
  await changeWorkspaceStoragePayersInTx(
    tx,
    ownedWorkspaces.map((ownedWorkspace) => ({
      workspaceId: ownedWorkspace.id,
      organizationId,
      billedAccountUserId: ownerMembership.userId,
      expectedCurrentPayer: {
        organizationId: ownedWorkspace.organizationId,
        billedAccountUserId: ownedWorkspace.billedAccountUserId,
      },
    }))
  )

  const attachedWorkspaceRows = await tx
    .update(workspace)
    .set({
      workspaceMode: WORKSPACE_MODE.ORGANIZATION,
      organizationAssignedAt: now,
      updatedAt: now,
    })
    .where(inArray(workspace.id, ownedWorkspaceIds))
    .returning({ id: workspace.id })
  const attachedWorkspaceIds = attachedWorkspaceRows.map((row) => row.id).sort()

  if (attachedWorkspaceIds.length > 0) {
    await tx
      .insert(permissions)
      .values(
        attachedWorkspaceIds.map((workspaceId) => ({
          id: generateId(),
          userId: ownerMembership.userId,
          entityType: 'workspace' as const,
          entityId: workspaceId,
          permissionType: 'admin' as const,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: [permissions.userId, permissions.entityType, permissions.entityId],
        set: { permissionType: 'admin', updatedAt: now },
      })
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
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION)
      )
    )

  const detachedWorkspaceIds = await db.transaction(async (tx) => {
    const now = new Date()
    const workspaceIds = organizationWorkspaces
      .map((organizationWorkspace) => organizationWorkspace.id)
      .sort()
    await lockWorkspaceRowsForPayerChanges(tx, workspaceIds)
    const payerChanges = organizationWorkspaces.map((organizationWorkspace) => ({
      workspaceId: organizationWorkspace.id,
      organizationId: null,
      billedAccountUserId: organizationOwnerId ?? organizationWorkspace.ownerId,
      expectedCurrentPayer: {
        organizationId,
        billedAccountUserId: organizationWorkspace.billedAccountUserId,
      },
    }))

    await changeWorkspaceStoragePayersInTx(tx, payerChanges)

    if (workspaceIds.length === 0) return []

    await tx
      .update(workspace)
      .set({
        workspaceMode: WORKSPACE_MODE.GRANDFATHERED_SHARED,
        organizationAssignedAt: null,
        updatedAt: now,
      })
      .where(inArray(workspace.id, workspaceIds))

    await tx
      .insert(permissions)
      .values(
        payerChanges.map(({ billedAccountUserId, workspaceId }) => ({
          id: generateId(),
          userId: billedAccountUserId,
          entityType: 'workspace' as const,
          entityId: workspaceId,
          permissionType: 'admin' as const,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: [permissions.userId, permissions.entityType, permissions.entityId],
        set: {
          permissionType: 'admin',
          updatedAt: now,
        },
      })

    return [...workspaceIds].sort()
  })

  const workspacesById = new Map(
    organizationWorkspaces.map((organizationWorkspace) => [
      organizationWorkspace.id,
      organizationWorkspace,
    ])
  )
  recordAuditBatch(
    detachedWorkspaceIds.map((detachedWorkspaceId) => {
      const detachedWorkspace = workspacesById.get(detachedWorkspaceId)
      return {
        workspaceId: detachedWorkspaceId,
        actorId: null,
        actorName: 'Billing System',
        action: AuditAction.WORKSPACE_UPDATED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: detachedWorkspaceId,
        description: 'Workspace detached from organization after its subscription ended',
        metadata: {
          organizationId,
          previousBilledAccountUserId: detachedWorkspace?.billedAccountUserId ?? null,
          newBilledAccountUserId: organizationOwnerId ?? detachedWorkspace?.ownerId ?? null,
        },
      }
    })
  )

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
