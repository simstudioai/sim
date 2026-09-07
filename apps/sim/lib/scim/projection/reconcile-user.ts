import { db } from '@sim/db'
import {
  type ScimConnectionSettings,
  scimGroupMapping,
  scimGroupMember,
  scimProjectionGrant,
  scimUser,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import {
  addPermissionGroupMemberTx,
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

export type ProjectionTargetKind = 'permission_group' | 'workspace' | 'org_role'

export interface ProjectionGrant {
  targetKind: ProjectionTargetKind
  targetId: string
  permissionType?: PermissionType
}

export interface ProjectionDelta {
  added: ProjectionGrant[]
  removed: ProjectionGrant[]
  /** Workspace grants whose level changed in either direction. */
  raised: ProjectionGrant[]
}

const EMPTY_DELTA: ProjectionDelta = { added: [], removed: [], raised: [] }

function grantKey(grant: ProjectionGrant): string {
  return `${grant.targetKind}:${grant.targetId}`
}

/**
 * What this user's group mappings entitle them to.
 *
 * Deliberately independent of whether the user is active. A deactivation blocks
 * sign-in and API keys through suspension; it does not withdraw grants, because
 * withdrawing a workspace grant reassigns the workflows the person owns there,
 * and that cannot be undone by reactivating them. Grants change only when group
 * membership or mappings change, or when the user is deprovisioned outright.
 */
async function desiredGrants(
  tx: DbOrTx,
  params: { scimUserId: string; settings: ScimConnectionSettings }
): Promise<ProjectionGrant[]> {
  const rows = await tx
    .select({
      targetKind: scimGroupMapping.targetKind,
      permissionGroupId: scimGroupMapping.permissionGroupId,
      workspaceId: scimGroupMapping.workspaceId,
      permissionType: scimGroupMapping.permissionType,
      role: scimGroupMapping.role,
    })
    .from(scimGroupMember)
    .innerJoin(scimGroupMapping, eq(scimGroupMapping.groupId, scimGroupMember.groupId))
    .where(eq(scimGroupMember.scimUserId, params.scimUserId))

  const byKey = new Map<string, ProjectionGrant>()

  for (const grant of params.settings.defaultWorkspaceGrants ?? []) {
    const entry: ProjectionGrant = {
      targetKind: 'workspace',
      targetId: grant.workspaceId,
      permissionType: grant.permission,
    }
    byKey.set(grantKey(entry), entry)
  }

  for (const row of rows) {
    if (row.targetKind === 'permission_group' && row.permissionGroupId) {
      const entry: ProjectionGrant = {
        targetKind: 'permission_group',
        targetId: row.permissionGroupId,
      }
      byKey.set(grantKey(entry), entry)
      continue
    }
    if (row.targetKind === 'workspace' && row.workspaceId && row.permissionType) {
      const entry: ProjectionGrant = {
        targetKind: 'workspace',
        targetId: row.workspaceId,
        permissionType: row.permissionType,
      }
      const existing = byKey.get(grantKey(entry))
      /** Two groups granting the same workspace resolve to the stronger one. */
      if (
        !existing?.permissionType ||
        permissionRank(row.permissionType) > permissionRank(existing.permissionType)
      ) {
        byKey.set(grantKey(entry), entry)
      }
      continue
    }
    if (row.targetKind === 'org_role' && row.role) {
      const entry: ProjectionGrant = { targetKind: 'org_role', targetId: row.role }
      byKey.set(grantKey(entry), entry)
    }
  }

  return [...byKey.values()]
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
 * Applies one grant. Returns false when the grant describes nothing this server
 * can apply, so the caller records provenance only for what actually happened.
 */
async function applyGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    /** The level a previous pass set on a workspace, when lowering it. */
    previousPermission?: PermissionType
  }
): Promise<boolean> {
  const { grant } = params
  switch (grant.targetKind) {
    case 'workspace':
      if (!grant.permissionType) return false
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
        return true
      }
      await grantWorkspaceAccessTx(tx, {
        workspaceId: grant.targetId,
        userId: params.userId,
        permission: grant.permissionType,
      })
      return true
    case 'org_role':
      if (grant.targetId !== 'admin') return false
      await changeMemberRoleTx(tx, {
        organizationId: params.organizationId,
        userId: params.userId,
        role: 'admin',
      })
      return true
    case 'permission_group':
      await addPermissionGroupMemberTx(tx, {
        organizationId: params.organizationId,
        groupId: grant.targetId,
        userId: params.userId,
        assignedBy: null,
        lockTimeoutAlreadyBounded: true,
      })
      return true
  }
}

async function withdrawGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    lockManualMembership: boolean
  }
): Promise<void> {
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
      if (!current) return
      if (
        !params.lockManualMembership &&
        grant.permissionType &&
        permissionRank(current) > permissionRank(grant.permissionType)
      ) {
        return
      }
      const outcome = await revokeWorkspaceAccessTx(tx, {
        workspaceId: grant.targetId,
        userId: params.userId,
      })
      if (!outcome.revoked && outcome.unresolvedWorkflows.length > 0) {
        logger.warn('Left workspace access in place: workflow ownership could not be reassigned', {
          workspaceId: grant.targetId,
          userId: params.userId,
          unresolved: outcome.unresolvedWorkflows.length,
        })
      }
      return
    }
    case 'org_role':
      if (grant.targetId !== 'admin') return
      await changeMemberRoleTx(tx, {
        organizationId: params.organizationId,
        userId: params.userId,
        role: 'member',
      })
      return
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

  const desired = await desiredGrants(tx, {
    scimUserId: params.scimUserId,
    settings: params.settings,
  })
  const current = await currentGrants(tx, params.scimUserId)

  const desiredByKey = new Map(desired.map((grant) => [grantKey(grant), grant]))
  const currentByKey = new Map(current.map((grant) => [grantKey(grant), grant]))

  const delta: ProjectionDelta = { added: [], removed: [], raised: [] }
  const lockManualMembership = params.settings.lockManualMembership === true

  /** Withdrawals first, so a move between groups frees its workspace slot. */
  for (const [key, grant] of currentByKey) {
    if (desiredByKey.has(key)) continue
    await withdrawGrant(tx, {
      organizationId: params.organizationId,
      userId: record.userId,
      grant,
      lockManualMembership,
    })
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

  for (const [key, grant] of desiredByKey) {
    const existing = currentByKey.get(key)
    const levelChanged =
      existing !== undefined &&
      grant.permissionType !== undefined &&
      existing.permissionType !== undefined &&
      grant.permissionType !== existing.permissionType

    if (existing && !levelChanged) continue

    let applied: boolean
    try {
      applied = await applyGrant(tx, {
        organizationId: params.organizationId,
        userId: record.userId,
        grant,
        ...(existing?.permissionType ? { previousPermission: existing.permissionType } : {}),
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
    if (!applied) continue

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

    if (levelChanged) delta.raised.push(grant)
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
