import { db } from '@sim/db'
import {
  member,
  type ScimConnectionSettings,
  scimGroupMapping,
  scimGroupMember,
  scimProjectionGrant,
  scimUser,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import {
  addPermissionGroupMemberTx,
  PermissionGroupNotFoundError,
  PermissionGroupScopeConflictError,
  removePermissionGroupMemberTx,
} from '@/lib/permission-groups/application/group-membership'
import {
  type MappingRow,
  type ProjectionGrant,
  type ProjectionTargetKind,
  planGrantChanges,
  resolveDesiredGrants,
} from '@/lib/scim/projection/grants'
import {
  grantWorkspaceAccessTx,
  lowerWorkspaceAccessTx,
  permissionRank,
  readWorkspacePermission,
  revokeWorkspaceAccessTx,
} from '@/lib/workspaces/access/workspace-access'

const logger = createLogger('ScimProjection')

/**
 * Turning directory group membership into Sim access.
 *
 * A SCIM group means nothing on its own; an administrator maps it to something
 * Sim understands. This module computes what a user's mappings say they should
 * have, compares it to what SCIM previously granted them, and applies only the
 * difference.
 *
 * The comparison is against SCIM's own grants, recorded in
 * `scim_projection_grant`, never against the user's total access. That is the
 * distinction that keeps a directory sync from revoking access a workspace
 * administrator granted by hand.
 */

export interface ProjectionDelta {
  added: ProjectionGrant[]
  removed: ProjectionGrant[]
  /** Workspace grants whose level changed in either direction. */
  raised: ProjectionGrant[]
}

const EMPTY_DELTA: ProjectionDelta = { added: [], removed: [], raised: [] }

/**
 * The mapping rows this user reaches through their groups.
 *
 * Deliberately independent of whether the user is active. A deactivation blocks
 * sign-in and API keys through suspension; it does not withdraw grants, because
 * withdrawing a workspace grant reassigns the workflows the person owns there,
 * and that cannot be undone by reactivating them. Grants change only when group
 * membership or mappings change, or when the user is deprovisioned outright.
 */
async function loadMappingRows(tx: DbOrTx, scimUserId: string): Promise<MappingRow[]> {
  return tx
    .select({
      targetKind: scimGroupMapping.targetKind,
      permissionGroupId: scimGroupMapping.permissionGroupId,
      workspaceId: scimGroupMapping.workspaceId,
      permissionType: scimGroupMapping.permissionType,
      role: scimGroupMapping.role,
    })
    .from(scimGroupMember)
    .innerJoin(scimGroupMapping, eq(scimGroupMapping.groupId, scimGroupMember.groupId))
    .where(eq(scimGroupMember.scimUserId, scimUserId))
}

async function currentGrants(tx: DbOrTx, scimUserId: string): Promise<ProjectionGrant[]> {
  const rows = await tx
    .select({
      targetKind: scimProjectionGrant.targetKind,
      targetId: scimProjectionGrant.targetId,
      permissionType: scimProjectionGrant.permissionType,
    })
    .from(scimProjectionGrant)
    .where(eq(scimProjectionGrant.scimUserId, scimUserId))
  return rows.map((row) => ({
    targetKind: row.targetKind as ProjectionTargetKind,
    targetId: row.targetId,
    ...(row.permissionType ? { permissionType: row.permissionType } : {}),
  }))
}

/**
 * What applying a grant did. `unchanged` means the person already held it by
 * some other route — a manual grant — and nothing was written.
 */
type GrantApplication = 'applied' | 'unchanged' | 'skipped'

/** Whether a mapped workspace still belongs to the organization the directory serves. */
async function workspaceBelongsToOrganization(
  tx: DbOrTx,
  workspaceId: string,
  organizationId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.organizationId, organizationId)))
    .limit(1)
  return Boolean(row)
}

/** Applies one grant. `skipped` means the grant describes nothing this server can apply. */
async function applyGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    /** The level a previous pass set on a workspace, when lowering it. */
    previousPermission?: PermissionType
  }
): Promise<GrantApplication> {
  const { grant } = params
  switch (grant.targetKind) {
    case 'workspace': {
      if (!grant.permissionType) return 'skipped'
      /**
       * A workspace can be moved to another organization after it was mapped.
       * The mapping row survives, and following it would hand this
       * organization's members access in a tenant the directory does not serve.
       */
      if (!(await workspaceBelongsToOrganization(tx, grant.targetId, params.organizationId))) {
        logger.warn('Skipped a SCIM mapping whose workspace is no longer in the organization', {
          workspaceId: grant.targetId,
          organizationId: params.organizationId,
        })
        return 'skipped'
      }
      if (
        params.previousPermission &&
        permissionRank(params.previousPermission) > permissionRank(grant.permissionType)
      ) {
        await lowerWorkspaceAccessTx(tx, {
          workspaceId: grant.targetId,
          userId: params.userId,
          from: params.previousPermission,
          to: grant.permissionType,
        })
        return 'applied'
      }
      const outcome = await grantWorkspaceAccessTx(tx, {
        workspaceId: grant.targetId,
        userId: params.userId,
        permission: grant.permissionType,
      })
      return outcome === 'unchanged' ? 'unchanged' : 'applied'
    }
    case 'org_role': {
      if (grant.targetId !== 'admin') return 'skipped'
      return setOrganizationRole(tx, params.organizationId, params.userId, 'admin')
    }
    case 'permission_group': {
      const outcome = await addPermissionGroupMemberTx(tx, {
        organizationId: params.organizationId,
        groupId: grant.targetId,
        userId: params.userId,
        assignedBy: null,
        lockTimeoutAlreadyBounded: true,
      })
      return outcome === 'already-member' ? 'unchanged' : 'applied'
    }
  }
}

/**
 * Sets a member's organization role on the directory's behalf.
 *
 * The owner is out of the directory's reach: ownership carries billing and the
 * last-owner guarantee, and a group that happens to contain the owner must not
 * fail every sync over it. Returns false, and records no grant, so the mapping
 * is simply inert for that one person.
 */
async function setOrganizationRole(
  tx: DbOrTx,
  organizationId: string,
  userId: string,
  role: 'admin' | 'member'
): Promise<GrantApplication> {
  try {
    const change = await changeMemberRoleTx(tx, { organizationId, userId, role })
    return change.changed ? 'applied' : 'unchanged'
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'conflict') {
      logger.warn('Skipped an organization role mapping for the owner', { organizationId, userId })
      return 'skipped'
    }
    if (error instanceof OrchestrationError && error.code === 'not_found') {
      logger.warn('Skipped an organization role mapping for a user who is no longer a member', {
        organizationId,
        userId,
      })
      return 'skipped'
    }
    throw error
  }
}

/**
 * Withdraws one grant. Returns false when the grant must stay in place — the
 * access could not be handed on — so the provenance row survives and the next
 * pass retries instead of forgetting.
 */
async function withdrawGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    lockManualMembership: boolean
  }
): Promise<boolean> {
  const { grant } = params
  switch (grant.targetKind) {
    case 'workspace': {
      /**
       * A grant raised by hand above what the directory set is left alone. The
       * directory said "at least write"; someone deliberately made it admin, and
       * removing the group should not silently undo that decision. When the
       * organization has made the directory the source of truth, it does.
       */
      const current = await readWorkspacePermission(tx, {
        workspaceId: grant.targetId,
        userId: params.userId,
      })
      if (!current) return true
      if (
        !params.lockManualMembership &&
        grant.permissionType &&
        permissionRank(current) > permissionRank(grant.permissionType)
      ) {
        return true
      }
      const outcome = await revokeWorkspaceAccessTx(tx, {
        workspaceId: grant.targetId,
        userId: params.userId,
      })
      if (!outcome.revoked) {
        logger.warn('Left workspace access in place: ownership could not be handed on', {
          workspaceId: grant.targetId,
          userId: params.userId,
          reason: outcome.reason,
        })
        return false
      }
      return true
    }
    case 'org_role':
      if (grant.targetId !== 'admin') return true
      await setOrganizationRole(tx, params.organizationId, params.userId, 'member')
      return true
    case 'permission_group':
      try {
        await removePermissionGroupMemberTx(tx, {
          organizationId: params.organizationId,
          groupId: grant.targetId,
          userId: params.userId,
          lockTimeoutAlreadyBounded: true,
        })
      } catch (error) {
        /**
         * The group may already be gone; the grant row outlives it because the
         * target column carries no foreign key. Withdrawing from nothing is
         * complete, not a failure.
         */
        if (!(error instanceof PermissionGroupNotFoundError)) throw error
      }
      return true
  }
}

/**
 * Brings a user's Sim access in line with their directory groups.
 *
 * Idempotent by construction: it reads the desired set, reads what SCIM granted
 * before, and acts only on the difference. Running it twice changes nothing the
 * second time, which is what lets the reconcile job re-run it over every user
 * without a dry-run mode.
 */
export async function reconcileUserProjection(
  tx: DbOrTx,
  params: {
    connectionId: string
    organizationId: string
    scimUserId: string
    settings: ScimConnectionSettings
  }
): Promise<ProjectionDelta> {
  const [record] = await tx
    .select({ userId: scimUser.userId })
    .from(scimUser)
    .where(and(eq(scimUser.id, params.scimUserId), eq(scimUser.connectionId, params.connectionId)))
    .limit(1)

  if (!record) return EMPTY_DELTA

  /**
   * Taken before any target is touched so the documented order holds: the
   * organization and membership locks first, the permission-group leaf lock
   * last. A withdrawal that reached the leaf lock before a later grant took the
   * organization lock would invert that order against a concurrent request.
   */
  await acquireOrganizationUserMutationLocks(tx, {
    userId: record.userId,
    organizationIds: [params.organizationId],
  })

  /**
   * Checked under the lock. A deprovisioning removes the membership and deletes
   * the SCIM row in separate commits; a pass that lands between them must not
   * grant workspace access to someone who has already left.
   */
  const [membership] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, params.organizationId), eq(member.userId, record.userId)))
    .limit(1)
  if (!membership) return EMPTY_DELTA

  const desired = resolveDesiredGrants(
    await loadMappingRows(tx, params.scimUserId),
    params.settings.defaultWorkspaceGrants ?? []
  )
  const plan = planGrantChanges(desired, await currentGrants(tx, params.scimUserId))

  const delta: ProjectionDelta = { added: [], removed: [], raised: [] }
  const lockManualMembership = params.settings.lockManualMembership === true

  /** Withdrawals first, so a move between groups frees its workspace slot. */
  for (const grant of plan.withdraw) {
    const withdrawn = await withdrawGrant(tx, {
      organizationId: params.organizationId,
      userId: record.userId,
      grant,
      lockManualMembership,
    })
    if (!withdrawn) continue
    await tx
      .delete(scimProjectionGrant)
      .where(
        and(
          eq(scimProjectionGrant.scimUserId, params.scimUserId),
          eq(scimProjectionGrant.targetKind, grant.targetKind),
          eq(scimProjectionGrant.targetId, grant.targetId)
        )
      )
    delta.removed.push(grant)
  }

  for (const { grant, previousPermission } of plan.apply) {
    let applied: GrantApplication
    try {
      applied = await applyGrant(tx, {
        organizationId: params.organizationId,
        userId: record.userId,
        grant,
        ...(previousPermission ? { previousPermission } : {}),
      })
    } catch (error) {
      /**
       * A mapping can outlive its target — an administrator deletes a permission
       * group and the row cascades away, or deletes the group between the read
       * and the write. And two mapped groups can collide: the same person in
       * both, each governing a shared workspace. Both are configuration problems
       * for the administrator to see in the activity log, not reasons to fail
       * the directory's request and have it retry forever.
       */
      if (error instanceof PermissionGroupNotFoundError) {
        logger.warn('Skipped a SCIM mapping whose permission group no longer exists', {
          connectionId: params.connectionId,
          groupId: grant.targetId,
        })
        continue
      }
      if (error instanceof PermissionGroupScopeConflictError) {
        logger.warn('Skipped a SCIM mapping that conflicts with another permission group', {
          connectionId: params.connectionId,
          groupId: grant.targetId,
          conflicts: error.conflicts.length,
        })
        continue
      }
      throw error
    }
    if (applied === 'skipped') continue
    /**
     * Access the person already held by hand is theirs, not the directory's.
     * Recording it as a directory grant would let a later group change revoke a
     * deliberate manual decision. Only when the organization has made the
     * directory the source of truth does the directory take ownership of it.
     */
    if (applied === 'unchanged' && !lockManualMembership && !previousPermission) continue

    await tx
      .insert(scimProjectionGrant)
      .values({
        id: generateId(),
        connectionId: params.connectionId,
        scimUserId: params.scimUserId,
        targetKind: grant.targetKind,
        targetId: grant.targetId,
        permissionType: grant.permissionType ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          scimProjectionGrant.scimUserId,
          scimProjectionGrant.targetKind,
          scimProjectionGrant.targetId,
        ],
        set: { permissionType: grant.permissionType ?? null, updatedAt: new Date() },
      })

    if (previousPermission) delta.raised.push(grant)
    else delta.added.push(grant)
  }

  return delta
}

/** Reconciles several users, in a stable order so concurrent syncs cannot deadlock. */
export async function reconcileUsersProjection(
  tx: DbOrTx,
  params: {
    connectionId: string
    organizationId: string
    scimUserIds: string[]
    settings: ScimConnectionSettings
  }
): Promise<void> {
  for (const scimUserId of [...new Set(params.scimUserIds)].sort()) {
    await reconcileUserProjection(tx, {
      connectionId: params.connectionId,
      organizationId: params.organizationId,
      scimUserId,
      settings: params.settings,
    })
  }
}

/**
 * Reconciles many users in transactions of a bounded size.
 *
 * For callers that are not already inside a transaction — the reconcile job,
 * and an administrator changing a mapping on a large group. One transaction over
 * thousands of users would hold the organization's advisory locks for its whole
 * duration, blocking every invitation and role change in the tenant meanwhile.
 */
export async function reconcileUsersProjectionInBatches(params: {
  connectionId: string
  organizationId: string
  scimUserIds: string[]
  settings: ScimConnectionSettings
  batchSize?: number
}): Promise<ProjectionDelta> {
  const total: ProjectionDelta = { added: [], removed: [], raised: [] }
  const ids = [...new Set(params.scimUserIds)].sort()
  const size = params.batchSize ?? 200
  for (let start = 0; start < ids.length; start += size) {
    const batch = ids.slice(start, start + size)
    await db.transaction(async (tx) => {
      for (const scimUserId of batch) {
        const delta = await reconcileUserProjection(tx, {
          connectionId: params.connectionId,
          organizationId: params.organizationId,
          scimUserId,
          settings: params.settings,
        })
        total.added.push(...delta.added)
        total.removed.push(...delta.removed)
        total.raised.push(...delta.raised)
      }
    })
  }
  return total
}
