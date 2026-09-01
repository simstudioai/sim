import { db } from '@sim/db'
import {
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  workspace,
} from '@sim/db/schema'
import { asc, count, desc, eq, inArray } from 'drizzle-orm'
import {
  type ActivePermissionGroupRestriction,
  getActivePermissionGroupRestrictions,
} from '@/lib/permission-groups/features'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'

/** A workspace reference (id + display name). */
export interface OrgWorkspaceRef {
  id: string
  name: string
}

/**
 * List an organization's workspaces ({id, name}), ordered by name.
 *
 * Lifted from the permission-groups route utils so non-route surfaces (the
 * copilot VFS) can read the org's workspace map without importing app/api.
 */
export async function listOrganizationWorkspaceRefs(
  organizationId: string
): Promise<OrgWorkspaceRef[]> {
  return db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(eq(workspace.organizationId, organizationId))
    .orderBy(asc(workspace.name))
}

export interface PermissionGroupRosterEntry {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  memberCount: number
  workspaces: OrgWorkspaceRef[]
  activeRestrictions: ActivePermissionGroupRestriction[]
}

/**
 * The org-admin roster: every permission group with its member count, the
 * workspaces it targets, and the restrictions its config actually activates.
 * The same joins the settings surface runs, without the route envelope.
 */
export async function listPermissionGroupRoster(
  organizationId: string
): Promise<PermissionGroupRosterEntry[]> {
  const groups = await db
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      description: permissionGroup.description,
      config: permissionGroup.config,
      isDefault: permissionGroup.isDefault,
    })
    .from(permissionGroup)
    .where(eq(permissionGroup.organizationId, organizationId))
    .orderBy(desc(permissionGroup.createdAt))

  const groupIds = groups.map((group) => group.id)
  const memberCounts = groupIds.length
    ? await db
        .select({
          permissionGroupId: permissionGroupMember.permissionGroupId,
          count: count(),
        })
        .from(permissionGroupMember)
        .where(inArray(permissionGroupMember.permissionGroupId, groupIds))
        .groupBy(permissionGroupMember.permissionGroupId)
    : []
  const countByGroupId = new Map(memberCounts.map((row) => [row.permissionGroupId, row.count]))

  const workspaceRows = groupIds.length
    ? await db
        .select({
          groupId: permissionGroupWorkspace.permissionGroupId,
          id: workspace.id,
          name: workspace.name,
        })
        .from(permissionGroupWorkspace)
        .innerJoin(workspace, eq(permissionGroupWorkspace.workspaceId, workspace.id))
        .where(inArray(permissionGroupWorkspace.permissionGroupId, groupIds))
        .orderBy(asc(workspace.name))
    : []
  const workspacesByGroupId = new Map<string, OrgWorkspaceRef[]>()
  for (const row of workspaceRows) {
    const list = workspacesByGroupId.get(row.groupId) ?? []
    list.push({ id: row.id, name: row.name })
    workspacesByGroupId.set(row.groupId, list)
  }

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    isDefault: group.isDefault,
    memberCount: countByGroupId.get(group.id) ?? 0,
    workspaces: workspacesByGroupId.get(group.id) ?? [],
    activeRestrictions: getActivePermissionGroupRestrictions(
      (group.config as PermissionGroupConfig | null) ?? null
    ),
  }))
}
