import { db } from '@sim/db'
import {
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
import { and, eq, inArray } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import {
  addPermissionGroupMemberTx,
  PermissionGroupAllMembersConflictError,
  PermissionGroupNotFoundError,
  PermissionGroupScopeConflictError,
  removePermissionGroupMemberTx,
} from '@/lib/permission-groups/application/group-membership'
import {
  grantWorkspaceAccessTx,
  lowerWorkspaceAccessTx,
  permissionRank,
  readWorkspacePermission,
  revokeWorkspaceAccessTx,
} from '@/lib/workspaces/access/workspace-access'
import {
  type MappingRow,
  type ProjectionGrant,
  type ProjectionGrantOrigin,
  type ProjectionTargetKind,
  planGrantChanges,
  resolveDesiredGrants,
} from '@/ee/scim/lib/projection/grants'

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

/** Users per transaction when projecting outside a request's own transaction; the organization lock is held for the batch. */
export const PROJECTION_BATCH_SIZE = 25

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
      origin: scimProjectionGrant.origin,
    })
    .from(scimProjectionGrant)
    .where(eq(scimProjectionGrant.scimUserId, scimUserId))
  return rows.map((row) => ({
    targetKind: row.targetKind as ProjectionTargetKind,
    targetId: row.targetId,
    origin: row.origin as ProjectionGrantOrigin,
    ...(row.permissionType ? { permissionType: row.permissionType } : {}),
  }))
}

/**
 * What applying a grant did. `unchanged` means the person already held it by
 * some other route — a manual grant — and nothing was written.
 */
type GrantOutcome = 'applied' | 'unchanged' | 'skipped'

/**
 * Mapped workspaces that no longer belong to the organization the directory
 * serves. A workspace can be moved to another tenant after it was mapped; the
 * mapping row survives, and following it in either direction would reach into
 * that tenant — granting members access there, or deleting rows it now owns.
 */
async function findForeignWorkspaces(
  tx: DbOrTx,
  workspaceIds: string[],
  organizationId: string
): Promise<Set<string>> {
  if (workspaceIds.length === 0) return new Set()
  const rows = await tx
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(inArray(workspace.id, workspaceIds), eq(workspace.organizationId, organizationId)))
  const owned = new Set(rows.map((row) => row.id))
  return new Set(workspaceIds.filter((id) => !owned.has(id)))
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
): Promise<GrantOutcome> {
  const { grant } = params
  switch (grant.targetKind) {
    case 'workspace': {
      if (!grant.permissionType) return 'skipped'
      if (
        params.previousPermission &&
        permissionRank(params.previousPermission) > permissionRank(grant.permissionType)
      ) {
        const lowered = await lowerWorkspaceAccessTx(tx, {
          workspaceId: grant.targetId,
          userId: params.userId,
          from: params.previousPermission,
          to: grant.permissionType,
        })
        if (lowered === 'lowered') return 'applied'
        /** The row is no longer at the level the directory set; ensure at least the desired level. */
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
): Promise<GrantOutcome> {
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
 *
 * Adopted access — held by hand before any mapping covered it — is the person's
 * own, so the directory only forgets its record of it, unless the organization
 * has made the directory the source of truth.
 */
async function withdrawGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    lockManualMembership: boolean
    foreignWorkspaceIds: Set<string>
  }
): Promise<boolean> {
  const { grant } = params
  if (grant.origin === 'adopted' && !params.lockManualMembership) return true
  switch (grant.targetKind) {
    case 'workspace': {
      /** The workspace belongs to another tenant now; its access is theirs to manage. Forget the grant. */
      if (params.foreignWorkspaceIds.has(grant.targetId)) return true
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
        })
      } catch (error) {
        /**
         * The group may already be gone; the grant row outlives it because the
         * target column carries no foreign key. Withdrawing from nothing is
         * complete, not a failure.
         */
        if (error instanceof PermissionGroupNotFoundError) return true
        /**
         * An administrator moved the group back to governing everyone, and its
         * last member cannot leave without emptying it. The grant stays on
         * record so a later pass, or the administrator, can settle it; a sync
         * must not fail over a rule the directory cannot see.
         */
        if (error instanceof PermissionGroupAllMembersConflictError) {
          logger.warn('Left a directory-managed permission group membership in place', {
            groupId: grant.targetId,
            userId: params.userId,
            conflict: error.message,
          })
          return false
        }
        throw error
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
   * Taken before any target is touched. The organization lock is the root of
   * every write path that reaches these tables, so holding it first is what
   * rules out a deadlock with the settings routes and with concurrent syncs;
   * the permission-group leaf lock is only ever taken underneath it.
   */
  await acquireOrganizationUserMutationLocks(tx, {
    userId: record.userId,
    organizationIds: [params.organizationId],
  })

  const current = await currentGrants(tx, params.scimUserId)
  const mapped = resolveDesiredGrants(await loadMappingRows(tx, params.scimUserId))
  const foreignWorkspaceIds = await findForeignWorkspaces(
    tx,
    [...mapped, ...current]
      .filter((grant) => grant.targetKind === 'workspace')
      .map((grant) => grant.targetId),
    params.organizationId
  )
  if (foreignWorkspaceIds.size > 0) {
    logger.warn('Ignoring SCIM workspace mappings whose workspace left the organization', {
      connectionId: params.connectionId,
      workspaceIds: [...foreignWorkspaceIds],
    })
  }
  const desired = mapped.filter(
    (grant) => grant.targetKind !== 'workspace' || !foreignWorkspaceIds.has(grant.targetId)
  )
  const plan = planGrantChanges(desired, current)

  const delta: ProjectionDelta = { added: [], removed: [], raised: [] }
  const lockManualMembership = params.settings.lockManualMembership === true

  /** Withdrawals first, so a move between groups frees its workspace slot. */
  for (const grant of plan.withdraw) {
    const withdrawn = await withdrawGrant(tx, {
      organizationId: params.organizationId,
      userId: record.userId,
      grant,
      lockManualMembership,
      foreignWorkspaceIds,
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
    let applied: GrantOutcome
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
     * Every satisfied mapping is recorded, so the next pass plans nothing for
     * it. Access the person already held by hand is recorded as adopted: the
     * directory knows the mapping is met but does not own the access, and a
     * later withdrawal leaves it alone.
     */
    await tx
      .insert(scimProjectionGrant)
      .values({
        id: generateId(),
        connectionId: params.connectionId,
        scimUserId: params.scimUserId,
        targetKind: grant.targetKind,
        targetId: grant.targetId,
        permissionType: grant.permissionType ?? null,
        origin: applied === 'applied' ? 'directory' : 'adopted',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          scimProjectionGrant.scimUserId,
          scimProjectionGrant.targetKind,
          scimProjectionGrant.targetId,
        ],
        set: {
          permissionType: grant.permissionType ?? null,
          ...(applied === 'applied' ? { origin: 'directory' } : {}),
          updatedAt: new Date(),
        },
      })

    if (applied !== 'applied') continue
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
}): Promise<ProjectionDelta> {
  const total: ProjectionDelta = { added: [], removed: [], raised: [] }
  const ids = [...new Set(params.scimUserIds)].sort()
  for (let start = 0; start < ids.length; start += PROJECTION_BATCH_SIZE) {
    const batch = ids.slice(start, start + PROJECTION_BATCH_SIZE)
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
