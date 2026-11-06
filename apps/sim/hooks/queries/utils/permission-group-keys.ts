export const PERMISSION_GROUP_MEMBERS_STALE_TIME = 30 * 1000
export const PERMISSION_GROUPS_STALE_TIME = 60 * 1000
export const PERMISSION_GROUP_EDITOR_CATALOG_STALE_TIME = 5 * 60 * 1000
export const PERMISSION_EDITOR_CATALOG_STALE_TIME = Number.POSITIVE_INFINITY

export const permissionGroupKeys = {
  all: ['permissionGroups'] as const,
  lists: () => [...permissionGroupKeys.all, 'list'] as const,
  list: (organizationId?: string) =>
    [...permissionGroupKeys.lists(), organizationId ?? ''] as const,
  details: () => [...permissionGroupKeys.all, 'detail'] as const,
  detail: (organizationId?: string, id?: string) =>
    [...permissionGroupKeys.details(), organizationId ?? '', id ?? ''] as const,
  members: (organizationId?: string, id?: string) =>
    [...permissionGroupKeys.detail(organizationId, id), 'members'] as const,
  userConfig: (workspaceId?: string) =>
    [...permissionGroupKeys.all, 'userConfig', workspaceId ?? ''] as const,
  editorCatalog: (organizationId?: string) =>
    [...permissionGroupKeys.all, 'editorCatalog', organizationId ?? ''] as const,
  orgWorkspaces: (organizationId?: string) =>
    [...permissionGroupKeys.all, 'orgWorkspaces', organizationId ?? ''] as const,
}
