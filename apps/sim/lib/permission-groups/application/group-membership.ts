import { permissionGroup, permissionGroupMember, permissionGroupWorkspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray, ne } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'

/**
 * Permission-group membership as a shared domain primitive.
 *
 * The conflict rules live here rather than in each caller because there are now
 * three: the settings UI, the bulk assignment route, and directory
 * provisioning. Two of them predate this module and carried the rules inline; a
 * third copy is where they would first diverge.
 */

/** A user already governed by another group that shares one of these workspaces. */
export interface PermissionGroupScopeConflict {
  userId: string
  groupId: string
  groupName: string
  workspaceId: string
}

export class PermissionGroupScopeConflictError extends Error {
  constructor(readonly conflicts: PermissionGroupScopeConflict[]) {
    super('The user is already governed by another permission group on a shared workspace')
    this.name = 'PermissionGroupScopeConflictError'
  }
}

export class PermissionGroupAllMembersConflictError extends Error {
  constructor(readonly workspaceId: string) {
    super(
      'Removing the last member would make this group govern every member of its workspaces, and another group already does'
    )
    this.name = 'PermissionGroupAllMembersConflictError'
  }
}

export class PermissionGroupNotFoundError extends Error {
  constructor() {
    super('Permission group not found')
    this.name = 'PermissionGroupNotFoundError'
  }
}

interface LockedGroup {
  id: string
  name: string
  isDefault: boolean
  membershipMode: string
  workspaceIds: string[]
}

async function loadLockedGroup(
  tx: DbOrTx,
  organizationId: string,
  groupId: string
): Promise<LockedGroup> {
  const [group] = await tx
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      isDefault: permissionGroup.isDefault,
      membershipMode: permissionGroup.membershipMode,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId)))
    .limit(1)
  if (!group) throw new PermissionGroupNotFoundError()

  const workspaces = await tx
    .select({ workspaceId: permissionGroupWorkspace.workspaceId })
    .from(permissionGroupWorkspace)
    .where(eq(permissionGroupWorkspace.permissionGroupId, groupId))

  return { ...group, workspaceIds: workspaces.map((row) => row.workspaceId) }
}

/** Groups other than this one that already govern the given user on a shared workspace. */
async function findScopeConflicts(
  tx: DbOrTx,
  params: { organizationId: string; groupId: string; workspaceIds: string[]; userId: string }
): Promise<PermissionGroupScopeConflict[]> {
  if (params.workspaceIds.length === 0) return []
  const rows = await tx
    .selectDistinct({
      userId: permissionGroupMember.userId,
      groupId: permissionGroup.id,
      groupName: permissionGroup.name,
      workspaceId: permissionGroupWorkspace.workspaceId,
    })
    .from(permissionGroupMember)
    .innerJoin(permissionGroup, eq(permissionGroup.id, permissionGroupMember.permissionGroupId))
    .innerJoin(
      permissionGroupWorkspace,
      eq(permissionGroupWorkspace.permissionGroupId, permissionGroup.id)
    )
    .where(
      and(
        eq(permissionGroup.organizationId, params.organizationId),
        eq(permissionGroup.isDefault, false),
        ne(permissionGroup.id, params.groupId),
        eq(permissionGroupMember.userId, params.userId),
        inArray(permissionGroupWorkspace.workspaceId, params.workspaceIds)
      )
    )
  return rows
}

/**
 * Another group that would collide once this one starts governing everybody.
 *
 * Only meaningful for a group in `inherit` mode, where emptying the member list
 * widens the group to every member of its workspaces.
 */
async function findAllMembersConflict(
  tx: DbOrTx,
  params: { organizationId: string; groupId: string; workspaceIds: string[] }
): Promise<string | null> {
  if (params.workspaceIds.length === 0) return null
  const rows = await tx
    .select({
      groupId: permissionGroup.id,
      workspaceId: permissionGroupWorkspace.workspaceId,
      memberCount: count(permissionGroupMember.id),
    })
    .from(permissionGroup)
    .innerJoin(
      permissionGroupWorkspace,
      eq(permissionGroupWorkspace.permissionGroupId, permissionGroup.id)
    )
    .leftJoin(
      permissionGroupMember,
      eq(permissionGroupMember.permissionGroupId, permissionGroup.id)
    )
    .where(
      and(
        eq(permissionGroup.organizationId, params.organizationId),
        eq(permissionGroup.isDefault, false),
        eq(permissionGroup.membershipMode, 'inherit'),
        ne(permissionGroup.id, params.groupId),
        inArray(permissionGroupWorkspace.workspaceId, params.workspaceIds)
      )
    )
    .groupBy(permissionGroup.id, permissionGroupWorkspace.workspaceId)

  return rows.find((row) => Number(row.memberCount) === 0)?.workspaceId ?? null
}

export type AddPermissionGroupMemberResult = 'added' | 'already-member'

/**
 * Adds a user to a permission group.
 *
 * Takes the organization's permission-group lock, which the lock ordering
 * documents as a leaf: acquire no further advisory lock after this one.
 */
export async function addPermissionGroupMemberTx(
  tx: DbOrTx,
  params: {
    organizationId: string
    groupId: string
    userId: string
    assignedBy: string | null
    lockTimeoutAlreadyBounded?: boolean
  }
): Promise<AddPermissionGroupMemberResult> {
  await acquirePermissionGroupOrgLock(tx, params.organizationId, {
    lockTimeoutAlreadyBounded: params.lockTimeoutAlreadyBounded ?? false,
  })
  const group = await loadLockedGroup(tx, params.organizationId, params.groupId)

  const [existing] = await tx
    .select({ id: permissionGroupMember.id })
    .from(permissionGroupMember)
    .where(
      and(
        eq(permissionGroupMember.permissionGroupId, params.groupId),
        eq(permissionGroupMember.userId, params.userId)
      )
    )
    .limit(1)
  if (existing) return 'already-member'

  const conflicts = await findScopeConflicts(tx, {
    organizationId: params.organizationId,
    groupId: params.groupId,
    workspaceIds: group.workspaceIds,
    userId: params.userId,
  })
  if (conflicts.length > 0) throw new PermissionGroupScopeConflictError(conflicts)

  await tx.insert(permissionGroupMember).values({
    id: generateId(),
    permissionGroupId: params.groupId,
    organizationId: params.organizationId,
    userId: params.userId,
    assignedBy: params.assignedBy,
    assignedAt: new Date(),
  })
  return 'added'
}

export type RemovePermissionGroupMemberResult = 'removed' | 'not-a-member'

/** Removes a user from a permission group. */
export async function removePermissionGroupMemberTx(
  tx: DbOrTx,
  params: {
    organizationId: string
    groupId: string
    userId: string
    lockTimeoutAlreadyBounded?: boolean
  }
): Promise<RemovePermissionGroupMemberResult> {
  await acquirePermissionGroupOrgLock(tx, params.organizationId, {
    lockTimeoutAlreadyBounded: params.lockTimeoutAlreadyBounded ?? false,
  })
  const group = await loadLockedGroup(tx, params.organizationId, params.groupId)

  const [member] = await tx
    .select({ id: permissionGroupMember.id })
    .from(permissionGroupMember)
    .where(
      and(
        eq(permissionGroupMember.permissionGroupId, params.groupId),
        eq(permissionGroupMember.userId, params.userId)
      )
    )
    .limit(1)
  if (!member) return 'not-a-member'

  /**
   * Emptying a non-default group in `inherit` mode flips it from governing
   * these users to governing everyone in its workspaces, and only one group may
   * do that per workspace. A group in `explicit` mode governs nobody when empty,
   * so it cannot collide and the check does not apply.
   */
  if (!group.isDefault && group.membershipMode === 'inherit') {
    const [remaining] = await tx
      .select({ value: count() })
      .from(permissionGroupMember)
      .where(eq(permissionGroupMember.permissionGroupId, params.groupId))
    if ((remaining?.value ?? 0) <= 1) {
      const conflict = await findAllMembersConflict(tx, {
        organizationId: params.organizationId,
        groupId: params.groupId,
        workspaceIds: group.workspaceIds,
      })
      if (conflict) throw new PermissionGroupAllMembersConflictError(conflict)
    }
  }

  await tx.delete(permissionGroupMember).where(eq(permissionGroupMember.id, member.id))
  return 'removed'
}
