import { db } from '@sim/db'
import {
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  user,
  workspace,
} from '@sim/db/schema'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import type { DbOrTx } from '@/lib/db/types'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

/** A workspace reference (id + display name). */
export interface WorkspaceRef {
  id: string
  name: string
}

/**
 * Authorize an organization-scoped access-control management request. The caller
 * must be an organization owner/admin and the organization must be entitled to
 * the Access Control (Permission Groups) enterprise feature. Returns a
 * `NextResponse` to short-circuit on failure, or `null` when authorized.
 */
export async function authorizeOrgAccessControl(
  userId: string,
  organizationId: string
): Promise<NextResponse | null> {
  const isAdmin = await isOrganizationAdminOrOwner(userId, organizationId)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
  }

  const entitled = await isOrganizationOnEnterprisePlan(organizationId)
  if (!entitled) {
    return NextResponse.json({ error: 'Access Control is an Enterprise feature' }, { status: 403 })
  }

  return null
}

const PERMISSION_GROUP_LOCK_TIMEOUT_MS = 5_000

/**
 * Serialize all permission-group membership and scope writes for an organization
 * via a transaction-scoped Postgres advisory lock. Callers acquire it at the top
 * of the transaction that both checks (`findScopeConflicts`) and mutates, so a
 * concurrent member add or scope change can't commit in the check-to-write
 * window and leave a user governed by two groups on the same workspace.
 *
 * The invariant (one effective group per user per workspace) spans users and
 * groups in ways a unique constraint can't express, and these are low-frequency
 * admin writes, so a single org-scoped lock is simpler and more obviously
 * correct than fine-grained per-user/per-group locks with acquire-ordering.
 *
 * `pg_advisory_xact_lock` auto-releases at transaction end (safe on pooled
 * connections), and `lock_timeout` bounds the wait (raising SQLSTATE 55P03)
 * instead of hanging if a holder is stuck.
 */
export async function acquirePermissionGroupOrgLock(
  tx: DbOrTx,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${PERMISSION_GROUP_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`permission_group:${organizationId}`}, 0))`
  )
}

/** Load a permission group only if it belongs to the given organization. */
export async function loadGroupInOrganization(
  groupId: string,
  organizationId: string,
  executor: DbOrTx = db
) {
  const [group] = await executor
    .select({
      id: permissionGroup.id,
      organizationId: permissionGroup.organizationId,
      name: permissionGroup.name,
      description: permissionGroup.description,
      config: permissionGroup.config,
      createdBy: permissionGroup.createdBy,
      createdAt: permissionGroup.createdAt,
      updatedAt: permissionGroup.updatedAt,
      isDefault: permissionGroup.isDefault,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId)))
    .limit(1)

  return group ?? null
}

/** The workspaces ({id, name}) a specific-scope group targets. */
export async function getGroupWorkspaces(
  groupId: string,
  executor: DbOrTx = db
): Promise<WorkspaceRef[]> {
  return executor
    .select({ id: workspace.id, name: workspace.name })
    .from(permissionGroupWorkspace)
    .innerJoin(workspace, eq(permissionGroupWorkspace.workspaceId, workspace.id))
    .where(eq(permissionGroupWorkspace.permissionGroupId, groupId))
    .orderBy(asc(workspace.name))
}

/** Batched map of `groupId -> targeted workspaces` for a list of groups. */
export async function getWorkspacesForGroups(
  groupIds: string[]
): Promise<Map<string, WorkspaceRef[]>> {
  const byGroup = new Map<string, WorkspaceRef[]>()
  if (groupIds.length === 0) return byGroup

  const rows = await db
    .select({
      groupId: permissionGroupWorkspace.permissionGroupId,
      id: workspace.id,
      name: workspace.name,
    })
    .from(permissionGroupWorkspace)
    .innerJoin(workspace, eq(permissionGroupWorkspace.workspaceId, workspace.id))
    .where(inArray(permissionGroupWorkspace.permissionGroupId, groupIds))
    .orderBy(asc(workspace.name))

  for (const row of rows) {
    const list = byGroup.get(row.groupId) ?? []
    list.push({ id: row.id, name: row.name })
    byGroup.set(row.groupId, list)
  }
  return byGroup
}

/** Returns the subset of `workspaceIds` that do NOT belong to the organization. */
export async function findWorkspacesNotInOrganization(
  workspaceIds: string[],
  organizationId: string
): Promise<string[]> {
  if (workspaceIds.length === 0) return []
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(inArray(workspace.id, workspaceIds), eq(workspace.organizationId, organizationId)))
  const valid = new Set(rows.map((row) => row.id))
  return workspaceIds.filter((id) => !valid.has(id))
}

/** List an organization's workspaces ({id, name}), ordered by name. */
export async function listOrganizationWorkspaces(organizationId: string): Promise<WorkspaceRef[]> {
  return db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(eq(workspace.organizationId, organizationId))
    .orderBy(asc(workspace.name))
}

/** A member whose other group membership would conflict with a candidate scope. */
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
 * ignored.
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

/**
 * Human-readable 409 message for a scope/membership conflict, naming the member
 * and the group they already belong to that overlaps the requested workspaces.
 */
export function formatScopeConflictError(conflicts: ScopeConflict[]): string {
  const [first] = conflicts
  if (!first) {
    return 'A member would be governed by two groups for the same workspace. Resolve their group memberships first.'
  }
  const who = first.userName || first.userEmail || 'A member'
  if (conflicts.length === 1) {
    return `${who} is already in the group "${first.conflictingGroupName}", which targets one of these workspaces. Remove them from one group first.`
  }
  const others = conflicts.length - 1
  return `${who} and ${others} other member${others === 1 ? '' : 's'} already belong to groups that target these workspaces (e.g. "${first.conflictingGroupName}"). Resolve their group memberships first.`
}

/**
 * Human-readable 409 message when another group already governs everyone in a
 * workspace this group would also apply to all members of.
 */
export function formatAllMembersConflictError(conflict: AllMembersConflict): string {
  return `The group "${conflict.conflictingGroupName}" already applies to everyone in "${conflict.workspaceName}". Two groups can't both govern all members of the same workspace — add members to one of them, or remove that workspace from one group first.`
}
