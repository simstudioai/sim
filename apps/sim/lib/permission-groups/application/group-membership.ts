import { db } from '@sim/db'
import {
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'

/**
 * Permission-group membership and the two rules that constrain it.
 *
 * The settings routes and directory provisioning both write membership, and
 * both must agree on when a write would leave a workspace governed by two
 * groups. The rules live here once; the routes consume them for their own
 * conflict messages, and the primitives below apply them for callers that do
 * not need a message.
 */

export interface ScopeConflict {
  userId: string
  userName: string | null
  userEmail: string | null
  /** The group the member already belongs to that causes the conflict. */
  conflictingGroupId: string
  conflictingGroupName: string
}

/**
 * Which of `candidateUserIds` would be governed by two groups on the same
 * workspace: each is already an explicit member of another non-default group
 * that shares one of `workspaceIds`. The candidate group (`excludeGroupId`) and
 * the org default group are ignored — the default never governs through
 * membership. Returns at most one conflict per user.
 */
export async function findScopeConflicts(
  params: {
    organizationId: string
    excludeGroupId: string
    workspaceIds: string[]
    candidateUserIds: string[]
  },
  executor: DbOrTx = db
): Promise<ScopeConflict[]> {
  const { organizationId, excludeGroupId, workspaceIds, candidateUserIds } = params
  if (candidateUserIds.length === 0 || workspaceIds.length === 0) return []

  const rows = await executor
    .select({
      userId: permissionGroupMember.userId,
      userName: user.name,
      userEmail: user.email,
      otherGroupId: permissionGroup.id,
      otherGroupName: permissionGroup.name,
    })
    .from(permissionGroupMember)
    .innerJoin(permissionGroup, eq(permissionGroupMember.permissionGroupId, permissionGroup.id))
    .innerJoin(
      permissionGroupWorkspace,
      eq(permissionGroupWorkspace.permissionGroupId, permissionGroup.id)
    )
    .leftJoin(user, eq(permissionGroupMember.userId, user.id))
    .where(
      and(
        eq(permissionGroupMember.organizationId, organizationId),
        inArray(permissionGroupMember.userId, candidateUserIds),
        ne(permissionGroupMember.permissionGroupId, excludeGroupId),
        eq(permissionGroup.isDefault, false),
        inArray(permissionGroupWorkspace.workspaceId, workspaceIds)
      )
    )

  const conflictByUser = new Map<string, ScopeConflict>()
  for (const row of rows) {
    if (conflictByUser.has(row.userId)) continue
    conflictByUser.set(row.userId, {
      userId: row.userId,
      userName: row.userName,
      userEmail: row.userEmail,
      conflictingGroupId: row.otherGroupId,
      conflictingGroupName: row.otherGroupName,
    })
  }
  return Array.from(conflictByUser.values())
}

/** An existing all-members group that already governs everyone in a shared workspace. */
export interface AllMembersConflict {
  conflictingGroupId: string
  conflictingGroupName: string
  workspaceName: string
}

/**
 * For a group that will govern *all members* of `workspaceIds` (a non-default
 * group with no explicit members), return the first other non-default
 * all-members group already targeting one of those workspaces, or `null`. Two
 * all-members groups on one workspace would both claim everyone there, so this
 * is rejected at assignment time. The candidate group (`excludeGroupId`) is
 * ignored, and so is any group in `explicit` membership mode: empty, it governs
 * nobody rather than everyone, so it cannot collide.
 */
export async function findAllMembersWorkspaceConflict(
  params: { organizationId: string; excludeGroupId: string; workspaceIds: string[] },
  executor: DbOrTx = db
): Promise<AllMembersConflict | null> {
  const { organizationId, excludeGroupId, workspaceIds } = params
  if (workspaceIds.length === 0) return null

  const [row] = await executor
    .select({
      conflictingGroupId: permissionGroup.id,
      conflictingGroupName: permissionGroup.name,
      workspaceName: workspace.name,
    })
    .from(permissionGroup)
    .innerJoin(
      permissionGroupWorkspace,
      eq(permissionGroupWorkspace.permissionGroupId, permissionGroup.id)
    )
    .innerJoin(workspace, eq(permissionGroupWorkspace.workspaceId, workspace.id))
    .where(
      and(
        eq(permissionGroup.organizationId, organizationId),
        eq(permissionGroup.isDefault, false),
        eq(permissionGroup.membershipMode, 'inherit'),
        ne(permissionGroup.id, excludeGroupId),
        inArray(permissionGroupWorkspace.workspaceId, workspaceIds),
        sql`not exists (
          select 1 from ${permissionGroupMember}
          where ${permissionGroupMember.permissionGroupId} = ${permissionGroup.id}
        )`
      )
    )
    .orderBy(asc(workspace.name))
    .limit(1)

  return row ?? null
}

export class PermissionGroupScopeConflictError extends Error {
  constructor(readonly conflicts: ScopeConflict[]) {
    super('The user is already governed by another permission group on a shared workspace')
    this.name = 'PermissionGroupScopeConflictError'
  }
}

export class PermissionGroupAllMembersConflictError extends Error {
  constructor(readonly conflict: AllMembersConflict) {
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

export type AddPermissionGroupMemberResult = 'added' | 'already-member'

/**
 * Adds a user to a permission group on the directory's behalf.
 *
 * The caller holds the organization lock, which has already bounded
 * `lock_timeout`; the permission-group lock taken here is the leaf, so no
 * further advisory lock may follow it. The membership has no human author.
 */
export async function addPermissionGroupMemberTx(
  tx: DbOrTx,
  params: { organizationId: string; groupId: string; userId: string }
): Promise<AddPermissionGroupMemberResult> {
  await acquirePermissionGroupOrgLock(tx, params.organizationId, {
    lockTimeoutAlreadyBounded: true,
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

  const conflicts = await findScopeConflicts(
    {
      organizationId: params.organizationId,
      excludeGroupId: params.groupId,
      workspaceIds: group.workspaceIds,
      candidateUserIds: [params.userId],
    },
    tx
  )
  if (conflicts.length > 0) throw new PermissionGroupScopeConflictError(conflicts)

  await tx.insert(permissionGroupMember).values({
    id: generateId(),
    permissionGroupId: params.groupId,
    organizationId: params.organizationId,
    userId: params.userId,
    assignedBy: null,
    assignedAt: new Date(),
  })
  return 'added'
}

export type RemovePermissionGroupMemberResult = 'removed' | 'not-a-member'

/** Removes a user from a permission group; the caller holds the organization lock. */
export async function removePermissionGroupMemberTx(
  tx: DbOrTx,
  params: { organizationId: string; groupId: string; userId: string }
): Promise<RemovePermissionGroupMemberResult> {
  await acquirePermissionGroupOrgLock(tx, params.organizationId, {
    lockTimeoutAlreadyBounded: true,
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
      const conflict = await findAllMembersWorkspaceConflict(
        {
          organizationId: params.organizationId,
          excludeGroupId: params.groupId,
          workspaceIds: group.workspaceIds,
        },
        tx
      )
      if (conflict) throw new PermissionGroupAllMembersConflictError(conflict)
    }
  }

  await tx.delete(permissionGroupMember).where(eq(permissionGroupMember.id, member.id))
  return 'removed'
}
