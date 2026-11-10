import { AuditAction, AuditResourceType, recordAuditBatch } from '@sim/audit'
import { db } from '@sim/db'
import { invitation, member, organization, permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  acquireOrganizationMutationLock,
  ensureUserInOrganizationTx,
  reapplyPaidOrgJoinBillingForExistingMemberTx,
} from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import type { PersonalOrganizationAuditActor } from '@/lib/organizations/lifecycle-audit'
import { findPersonalChatDestinationWorkspaceId } from '@/lib/organizations/personal-chats'
import { findSplitProjectWorkspaceIds, transferWorkspaceProjects } from '@/lib/projects/membership'
import { invalidateWorkspaceTableLimitsCache } from '@/lib/table/billing'
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
  /** Emit with `recordAuditBatch` once the surrounding transaction has committed. */
  auditEntries: Parameters<typeof recordAuditBatch>[0]
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
 *     *different* team organization — used by manual org creation.
 *   - `keep-external`: collaborators in a *different* team organization stay
 *     external workspace members and the attach proceeds; collaborators in no
 *     organization at all are joined into it — used by the Pro→Team
 *     conversion, which must not abort just because a personal workspace
 *     already has an external collaborator.
 *   - `external-all`: nobody joins the organization as a side effect — every
 *     collaborator who is not already a member stays an external workspace
 *     member. Used when a joining member's owned workspaces follow them into
 *     the organization: membership (and its seat) only ever comes from an
 *     invitation the person accepted or an explicit admin action.
 *
 * Under every policy a collaborator holding their own personal organization stays
 * an external workspace member.
 */
type ExternalMemberPolicy = 'reject' | 'keep-external' | 'external-all'

/**
 * The single definition of "a workspace that follows this user into an
 * organization": owned (or billed) by them, in no organization or in their
 * personal organization (whose workspaces return there first), and —
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
    or(
      isNull(workspace.organizationId),
      inArray(
        workspace.organizationId,
        db
          .select({ id: member.organizationId })
          .from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .where(and(eq(member.userId, userId), eq(organization.kind, 'personal')))
      )
    ),
    ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
    ...(includeArchived ? [] : [isNull(workspace.archivedAt)])
  )
}

/**
 * The joiner's owned workspaces a team join sweeps into the team, sorted: every attachable one
 * (archived included) except the workspace their personal organization's chats move into, which
 * stays theirs and outside the team so the team's data drains never export those chats.
 */
export async function joinAttachableWorkspaceIds(
  executor: DbOrTx,
  userId: string
): Promise<string[]> {
  const owned = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(ownedAttachableWorkspacesWhere({ userId, includeArchived: true }))
  const chatWorkspaceId = await findPersonalChatDestinationWorkspaceId(executor, userId)
  return owned
    .map((row) => row.id)
    .filter((id) => id !== chatWorkspaceId)
    .sort()
}

/**
 * Whether the joiner's attachable workspaces, re-read under the join's locks, are still the set
 * planned before them. The workspace the join's retirement moved the chats into is left out of
 * the re-read, since the retirement may just have created it, and a plan that would attach it (a
 * chat written after the plan) is stale.
 */
export async function joinAttachSetUnchangedTx(
  tx: DbTransaction,
  {
    userId,
    plannedWorkspaceIds,
    chatWorkspaceId,
  }: { userId: string; plannedWorkspaceIds: string[]; chatWorkspaceId: string | null }
): Promise<boolean> {
  if (chatWorkspaceId && plannedWorkspaceIds.includes(chatWorkspaceId)) return false
  const current = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(ownedAttachableWorkspacesWhere({ userId, includeArchived: true }))
  const currentIds = current
    .map((row) => row.id)
    .filter((id) => id !== chatWorkspaceId)
    .sort()
  return currentIds.join() === [...plannedWorkspaceIds].sort().join()
}

/**
 * Locks workspace rows before any payer or membership mutation. `FOR NO KEY
 * UPDATE` keeps this compatible with the implicit foreign-key `FOR KEY SHARE`
 * concurrent writers hold; see the module header of
 * `lib/billing/storage/tracking.ts`.
 */
async function lockWorkspaceRowsForPayerChanges(tx: DbOrTx, workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0) return
  await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(inArray(workspace.id, [...workspaceIds].sort()))
    .orderBy(asc(workspace.id))
    .for('no key update')
}

interface AttachOwnedWorkspacesToOrganizationParams {
  ownerUserId: string
  organizationId: string
  /** Who triggered the attach, recorded when it joins a collaborator in no organization. */
  actor: PersonalOrganizationAuditActor
  externalMemberPolicy?: ExternalMemberPolicy
  /**
   * Also attach archived workspaces. Join-attach sweeps them so unarchiving
   * later can never resurface a personal workspace outside the organization.
   */
  includeArchived?: boolean
  /**
   * Leave a workspace whose Project also holds an environment outside the sweep where it is,
   * instead of failing the whole attach on it. For sweeps nobody asked for, such as a Team
   * subscription's billing webhook.
   */
  skipSplitProjects?: boolean
}

export async function attachOwnedWorkspacesToOrganization({
  ownerUserId,
  organizationId,
  externalMemberPolicy = 'reject',
  includeArchived = false,
  skipSplitProjects = false,
  actor,
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
    // Shared advisory scope first, then the organization lock, then workspace
    // rows — the order admin move uses. What makes it mandatory is acceptance:
    // it holds `workspace-invitations:<id>` while waiting for the workspace
    // row, so row-locking first here (as this did) deadlocks against it.
    // Taking the organization lock before the rows also matches ownership
    // transfer, so those two cannot invert on the org/row pair either.
    await acquireInvitationMutationLocks(tx, {
      invitationIds: [],
      workspaceIds: ownedWorkspaceIds,
    })
    await acquireOrganizationMutationLock(tx, organizationId)
    await lockWorkspaceRowsForPayerChanges(tx, ownedWorkspaceIds)
    const splitWorkspaceIds = skipSplitProjects
      ? await findSplitProjectWorkspaceIds(tx, ownedWorkspaceIds)
      : new Set<string>()
    if (splitWorkspaceIds.size > 0) {
      logger.warn('Left workspaces outside the organization: their Project spans owners', {
        ownerUserId,
        organizationId,
        skippedWorkspaceIds: [...splitWorkspaceIds],
      })
    }
    return attachOwnedWorkspacesToOrganizationTx(tx, {
      ownerUserId,
      organizationId,
      workspaceIds: ownedWorkspaceIds.filter((id) => !splitWorkspaceIds.has(id)),
      externalMemberPolicy,
      ownerMatch: 'owner',
      includeArchived,
      actor,
    })
  })

  for (const workspaceId of attached.attachedWorkspaceIds) {
    invalidateWorkspaceTableLimitsCache(workspaceId)
  }
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
  tx: DbTransaction,
  {
    ownerUserId,
    organizationId,
    workspaceIds,
    externalMemberPolicy = 'keep-external',
    ownerMatch = 'billing-account',
    includeArchived = false,
    actor,
  }: {
    ownerUserId: string
    organizationId: string
    workspaceIds: string[]
    externalMemberPolicy?: ExternalMemberPolicy
    ownerMatch?: 'owner' | 'billing-account'
    includeArchived?: boolean
    actor: PersonalOrganizationAuditActor
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
      archivedAt: workspace.archivedAt,
    })
    .from(workspace)
    .where(
      and(
        ownedAttachableWorkspacesWhere({ userId: ownerUserId, ownerMatch, includeArchived }),
        inArray(workspace.id, workspaceIds)
      )
    )
    .orderBy(asc(workspace.id))
    .for('no key update')

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
  /**
   * Collaborators are enumerated from ACTIVE workspaces only. Archived
   * workspaces still attach (so unarchiving can never dodge the organization),
   * but sweeping them must not change who becomes a member: a forgotten
   * collaborator on an archived workspace would otherwise be joined — and
   * billed as a seat — by an upgrade they had nothing to do with. Anyone
   * reachable only through an archived workspace stays an external member.
   */
  const activeWorkspaceIds = ownedWorkspaces.filter((row) => !row.archivedAt).map((row) => row.id)
  const permissionRows =
    activeWorkspaceIds.length > 0
      ? await tx
          .select({ userId: permissions.userId })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              inArray(permissions.entityId, activeWorkspaceIds)
            )
          )
      : []
  const workspaceMemberIds = [...new Set(permissionRows.map((row) => row.userId))].sort()
  const memberships =
    workspaceMemberIds.length > 0
      ? await tx
          .select({
            userId: member.userId,
            organizationId: member.organizationId,
            kind: organization.kind,
          })
          .from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .where(inArray(member.userId, workspaceMemberIds))
      : []
  const membershipByUser = new Map(
    memberships.filter((row) => row.kind === 'team').map((row) => [row.userId, row.organizationId])
  )
  /**
   * A collaborator in their own personal organization stays an external workspace member under
   * every policy, never a conflict and never joined: joining would retire their personal
   * organization (deleting its shared content, pausing their Pro) over someone else's upgrade.
   */
  const personalMemberIds = new Set(
    memberships.filter((row) => row.kind === 'personal').map((row) => row.userId)
  )
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
  for (const userId of workspaceMemberIds) {
    if (membershipByUser.has(userId)) continue
    if (personalMemberIds.has(userId)) {
      skippedMembers.push({
        userId,
        reason: 'Holds a personal organization; kept as external workspace member',
      })
    } else if (externalMemberPolicy === 'external-all') {
      skippedMembers.push({
        userId,
        reason: 'Not an organization member; kept as external workspace member',
      })
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
      actor,
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
  await transferWorkspaceProjects(
    tx,
    ownedWorkspaceIds,
    organizationId,
    undefined,
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
  const result = await db.transaction((tx) => detachOrganizationWorkspacesTx(tx, organizationId))
  recordAuditBatch(result.auditEntries)
  return result
}

/**
 * Transaction-enlisted detach, for callers that must commit the detach together
 * with something else — deleting the organization, for instance, where a
 * detach that committed on its own would leave workspaces re-billed while the
 * organization it was meant to empty still exists.
 *
 * Returns its audit rows in `auditEntries` rather than writing them. Callers
 * pass them to `recordAuditBatch` only after their transaction commits: the
 * write is fire-and-forget, so emitting it here would leave audit history
 * describing detachments that a later rollback undid.
 */
export async function detachOrganizationWorkspacesTx(
  tx: DbTransaction,
  organizationId: string
): Promise<DetachOrganizationWorkspacesResult> {
  const organizationWorkspacesWhere = and(
    eq(workspace.organizationId, organizationId),
    eq(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION)
  )
  const workspaceSnapshot = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(organizationWorkspacesWhere)
  const organizationInvitationsWhere = eq(invitation.organizationId, organizationId)
  const invitationSnapshot = await tx
    .select({ id: invitation.id })
    .from(invitation)
    .where(organizationInvitationsWhere)
  const lockedWorkspaceIds = new Set(workspaceSnapshot.map(({ id }) => id))
  const lockedInvitationIds = new Set(invitationSnapshot.map(({ id }) => id))

  /**
   * Acceptance locks invitations before workspaces; enlisted organization deletion
   * also cascades invitation rows. Resend checks organization policy even for
   * terminal invitations, so their locks also precede the organization fence.
   */
  await acquireInvitationMutationLocks(tx, {
    invitationIds: [...lockedInvitationIds],
    workspaceIds: [...lockedWorkspaceIds],
  })
  await acquireOrganizationMutationLock(tx, organizationId)
  const organizationOwnerId = await getOrganizationOwnerId(organizationId, tx)
  if (!organizationOwnerId) {
    logger.warn(
      'Detaching workspaces from an organization without an owner; using workspace owner as billed account',
      { organizationId }
    )
  }

  const organizationWorkspaces = await tx
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(organizationWorkspacesWhere)

  if (organizationWorkspaces.some(({ id }) => !lockedWorkspaceIds.has(id))) {
    throw new OrchestrationError(
      'conflict',
      'Organization workspaces changed during detachment; retry'
    )
  }
  const organizationInvitations = await tx
    .select({ id: invitation.id })
    .from(invitation)
    .where(organizationInvitationsWhere)
  if (organizationInvitations.some(({ id }) => !lockedInvitationIds.has(id))) {
    throw new OrchestrationError(
      'conflict',
      'Organization invitations changed during detachment; retry'
    )
  }

  const detachedWorkspaceIds = await (async () => {
    const now = new Date()
    const workspaceIds = organizationWorkspaces
      .map((organizationWorkspace) => organizationWorkspace.id)
      .sort()
    const payerChanges = organizationWorkspaces.map((organizationWorkspace) => ({
      workspaceId: organizationWorkspace.id,
      organizationId: null,
      billedAccountUserId: organizationOwnerId ?? organizationWorkspace.ownerId,
      expectedCurrentPayer: {
        organizationId,
        billedAccountUserId: organizationWorkspace.billedAccountUserId,
      },
    }))

    await transferWorkspaceProjects(
      tx,
      workspaceIds,
      null,
      organizationOwnerId ?? undefined,
      payerChanges
    )

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
  })()

  logger.info('Detached organization workspaces', {
    organizationId,
    detachedWorkspaceCount: detachedWorkspaceIds.length,
    billedAccountUserId: organizationOwnerId,
  })

  const workspacesById = new Map(
    organizationWorkspaces.map((organizationWorkspace) => [
      organizationWorkspace.id,
      organizationWorkspace,
    ])
  )

  return {
    detachedWorkspaceIds,
    billedAccountUserId: organizationOwnerId,
    auditEntries: detachedWorkspaceIds.map((detachedWorkspaceId) => {
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
    }),
  }
}
