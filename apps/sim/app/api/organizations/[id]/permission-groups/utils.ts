import { db } from '@sim/db'
import { permissionGroup, permissionGroupWorkspace, workspace } from '@sim/db/schema'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import type { DbOrTx } from '@/lib/db/types'
import type {
  AllMembersConflict,
  ScopeConflict,
} from '@/lib/permission-groups/application/group-membership'
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
      membershipMode: permissionGroup.membershipMode,
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
