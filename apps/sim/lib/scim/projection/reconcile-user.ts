import {
  type ScimConnectionSettings,
  scimGroupMapping,
  scimGroupMember,
  scimProjectionGrant,
  scimUser,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { PermissionType } from '@sim/platform-authz/workspace'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import {
  addPermissionGroupMemberTx,
  PermissionGroupNotFoundError,
  removePermissionGroupMemberTx,
} from '@/lib/permission-groups/application/group-membership'
import {
  grantWorkspaceAccessTx,
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
  raised: ProjectionGrant[]
}

const EMPTY_DELTA: ProjectionDelta = { added: [], removed: [], raised: [] }

function grantKey(grant: ProjectionGrant): string {
  return `${grant.targetKind}:${grant.targetId}`
}

/**
 * What this user's group mappings entitle them to.
 *
 * An inactive user is entitled to nothing: a deactivation must withdraw access
 * rather than merely blocking sign-in, so that a reactivation is what restores
 * it and nothing is left dangling in between.
 */
async function desiredGrants(
  tx: DbOrTx,
  params: { scimUserId: string; active: boolean; settings: ScimConnectionSettings }
): Promise<ProjectionGrant[]> {
  if (!params.active) return []

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

async function applyGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    lockTimeoutAlreadyBounded: boolean
  }
): Promise<void> {
  const { grant } = params
  switch (grant.targetKind) {
    case 'workspace':
      if (!grant.permissionType) return
      await grantWorkspaceAccessTx(tx, {
        workspaceId: grant.targetId,
        userId: params.userId,
        permission: grant.permissionType,
      })
      return
    case 'org_role':
      if (grant.targetId !== 'admin') return
      await changeMemberRoleTx(tx, {
        organizationId: params.organizationId,
        userId: params.userId,
        role: 'admin',
      })
      return
    case 'permission_group':
      /**
       * Last, because the permission-group lock is a documented leaf: no further
       * advisory lock may be taken after it.
       */
      await addPermissionGroupMemberTx(tx, {
        organizationId: params.organizationId,
        groupId: grant.targetId,
        userId: params.userId,
        assignedBy: null,
        lockTimeoutAlreadyBounded: params.lockTimeoutAlreadyBounded,
      })
  }
}

async function withdrawGrant(
  tx: DbOrTx,
  params: {
    organizationId: string
    userId: string
    grant: ProjectionGrant
    lockManualMembership: boolean
    lockTimeoutAlreadyBounded: boolean
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
      await removePermissionGroupMemberTx(tx, {
        organizationId: params.organizationId,
        groupId: grant.targetId,
        userId: params.userId,
        lockTimeoutAlreadyBounded: params.lockTimeoutAlreadyBounded,
      })
  }
}

/**
 * Brings a user's Sim access in line with their directory groups.
 *
 * Idempotent by construction: it reads the desired set, reads what SCIM granted
 * before, and acts only on the difference. Running it twice changes nothing the
 * second time, which is what lets the reconcile job re-run it over every user
 * without a dry-run mode.
 *
 * Ordering within the transaction follows the documented advisory-lock order:
 * workspace and role writes first, permission-group writes last.
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
    .select({
      userId: scimUser.userId,
      active: scimUser.active,
      suspendedAt: user.suspendedAt,
    })
    .from(scimUser)
    .innerJoin(user, eq(user.id, scimUser.userId))
    .where(and(eq(scimUser.id, params.scimUserId), eq(scimUser.connectionId, params.connectionId)))
    .limit(1)

  if (!record) return EMPTY_DELTA

  const desired = await desiredGrants(tx, {
    scimUserId: params.scimUserId,
    active: record.active && record.suspendedAt === null,
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
      lockTimeoutAlreadyBounded: false,
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
    const raised =
      existing !== undefined &&
      grant.permissionType !== undefined &&
      existing.permissionType !== undefined &&
      permissionRank(grant.permissionType) > permissionRank(existing.permissionType)

    if (existing && !raised) continue

    try {
      await applyGrant(tx, {
        organizationId: params.organizationId,
        userId: record.userId,
        grant,
        lockTimeoutAlreadyBounded: false,
      })
    } catch (error) {
      /**
       * A mapping can outlive its target — an administrator deletes a permission
       * group and the row cascades away, or deletes the group between the read
       * and the write. Skipping one target is right; failing the whole
       * provisioning request over it is not.
       */
      if (error instanceof PermissionGroupNotFoundError) {
        logger.warn('Skipped a SCIM mapping whose permission group no longer exists', {
          connectionId: params.connectionId,
          groupId: grant.targetId,
        })
        continue
      }
      throw error
    }

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

    if (raised) delta.raised.push(grant)
    else delta.added.push(grant)
  }

  return delta
}

/** Withdraws everything SCIM granted a user, for deprovisioning. */
export async function withdrawAllProjectedGrants(
  tx: DbOrTx,
  params: { connectionId: string; organizationId: string; scimUserId: string; userId: string }
): Promise<void> {
  const grants = await currentGrants(tx, params.scimUserId)
  for (const grant of grants) {
    await withdrawGrant(tx, {
      organizationId: params.organizationId,
      userId: params.userId,
      grant,
      /** Deprovisioning removes access regardless of later manual changes. */
      lockManualMembership: true,
      lockTimeoutAlreadyBounded: false,
    })
  }
  await tx.delete(scimProjectionGrant).where(eq(scimProjectionGrant.scimUserId, params.scimUserId))
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
