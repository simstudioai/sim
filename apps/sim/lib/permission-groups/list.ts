import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, user, workspace } from '@sim/db/schema'
import { and, count, eq, inArray } from 'drizzle-orm'
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { parsePermissionGroupConfig } from '@/lib/permission-groups/fields'
import { getWorkspacesForGroups } from '@/lib/permission-groups/repository'

export interface PermissionGroupListOptions<SortBy extends string> {
  sortBy?: SortBy
  sortOrder?: ListSortOrder
  limit?: number
  cursorKeys?: CursorKey[]
}
export type PermissionGroupSortBy = 'name' | 'createdAt' | 'updatedAt'
export type PermissionGroupMemberSortBy = 'assignedAt' | 'userId'
export type PermissionGroupWorkspaceSortBy = 'name' | 'id'

type GroupRow = typeof permissionGroup.$inferSelect
const groupSortKeys = {
  name: textKey<GroupRow>(permissionGroup.name, (row) => row.name),
  createdAt: timestampKey<GroupRow>(permissionGroup.createdAt, (row) => row.createdAt),
  updatedAt: timestampKey<GroupRow>(permissionGroup.updatedAt, (row) => row.updatedAt),
} satisfies Record<PermissionGroupSortBy, KeysetKey<GroupRow>>

export async function listPermissionGroupRecords(
  organizationId: string,
  options: PermissionGroupListOptions<PermissionGroupSortBy> & { search?: string } = {}
) {
  const keys = [
    groupSortKeys[options.sortBy ?? 'createdAt'],
    textKey<GroupRow>(permissionGroup.id, (row) => row.id),
  ]
  const order = options.sortOrder ?? 'desc'
  const query = db
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
      creatorName: user.name,
      creatorEmail: user.email,
    })
    .from(permissionGroup)
    .leftJoin(user, eq(permissionGroup.createdBy, user.id))
    .where(
      and(
        eq(permissionGroup.organizationId, organizationId),
        searchFilter(permissionGroup.name, options.search),
        resumeKeyset(keys, options.cursorKeys, order)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), order))
  const page = keysetPage(
    keys,
    await (options.limit === undefined ? query : query.limit(options.limit + 1)),
    options.limit
  )
  const ids = page.data.map((group) => group.id)
  const counts = ids.length
    ? await db
        .select({ id: permissionGroupMember.permissionGroupId, count: count() })
        .from(permissionGroupMember)
        .where(inArray(permissionGroupMember.permissionGroupId, ids))
        .groupBy(permissionGroupMember.permissionGroupId)
    : []
  const countsById = new Map(counts.map((row) => [row.id, row.count]))
  const workspaces = await getWorkspacesForGroups(ids)
  return {
    data: page.data.map((group) => ({
      ...group,
      config: parsePermissionGroupConfig(group.config),
      memberCount: countsById.get(group.id) ?? 0,
      workspaces: group.isDefault ? [] : (workspaces.get(group.id) ?? []),
      workspaceIds: group.isDefault ? [] : (workspaces.get(group.id) ?? []).map((item) => item.id),
    })),
    nextCursorKeys: page.nextCursorKeys,
  }
}

type MemberRow = { id: string; userId: string; assignedAt: Date }
const memberSortKeys = {
  assignedAt: timestampKey<MemberRow>(permissionGroupMember.assignedAt, (row) => row.assignedAt),
  userId: textKey<MemberRow>(permissionGroupMember.userId, (row) => row.userId),
} satisfies Record<PermissionGroupMemberSortBy, KeysetKey<MemberRow>>

export async function listPermissionGroupMemberRecords(
  groupId: string,
  options: PermissionGroupListOptions<PermissionGroupMemberSortBy> = {}
) {
  const keys = [
    memberSortKeys[options.sortBy ?? 'assignedAt'],
    textKey<MemberRow>(permissionGroupMember.id, (row) => row.id),
  ]
  const order = options.sortOrder ?? 'asc'
  const query = db
    .select({
      id: permissionGroupMember.id,
      userId: permissionGroupMember.userId,
      assignedAt: permissionGroupMember.assignedAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(permissionGroupMember)
    .leftJoin(user, eq(permissionGroupMember.userId, user.id))
    .where(
      and(
        eq(permissionGroupMember.permissionGroupId, groupId),
        resumeKeyset(keys, options.cursorKeys, order)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), order))
  return keysetPage(
    keys,
    await (options.limit === undefined ? query : query.limit(options.limit + 1)),
    options.limit
  )
}

type WorkspaceRow = { id: string; name: string }
const workspaceSortKeys = {
  name: textKey<WorkspaceRow>(workspace.name, (row) => row.name),
  id: textKey<WorkspaceRow>(workspace.id, (row) => row.id),
} satisfies Record<PermissionGroupWorkspaceSortBy, KeysetKey<WorkspaceRow>>

export async function listPermissionGroupWorkspaceRecords(
  organizationId: string,
  options: PermissionGroupListOptions<PermissionGroupWorkspaceSortBy> & { search?: string } = {}
) {
  const sortBy = options.sortBy ?? 'name'
  const keys =
    sortBy === 'id' ? [workspaceSortKeys.id] : [workspaceSortKeys.name, workspaceSortKeys.id]
  const order = options.sortOrder ?? 'asc'
  const query = db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        searchFilter(workspace.name, options.search),
        resumeKeyset(keys, options.cursorKeys, order)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), order))
  return keysetPage(
    keys,
    await (options.limit === undefined ? query : query.limit(options.limit + 1)),
    options.limit
  )
}
