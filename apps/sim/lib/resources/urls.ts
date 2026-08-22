const WORKSPACE_RESOURCE_KINDS = [
  'file',
  'folder',
  'knowledge',
  'skill',
  'table',
  'workflow',
] as const

export type WorkspaceResourceKind = (typeof WORKSPACE_RESOURCE_KINDS)[number]

/** Whether a resource kind has a canonical destination in the workspace UI. */
export function isWorkspaceResourceKind(kind: string): kind is WorkspaceResourceKind {
  return WORKSPACE_RESOURCE_KINDS.some((candidate) => candidate === kind)
}

/** Builds the canonical in-app path for a navigable workspace resource. */
export function workspaceResourcePath(
  workspaceId: string,
  kind: WorkspaceResourceKind,
  resourceId: string
): string {
  const workspace = encodeURIComponent(workspaceId)
  const resource = encodeURIComponent(resourceId)
  const base = `/workspace/${workspace}`

  switch (kind) {
    case 'file':
      return `${base}/files/${resource}`
    case 'folder':
      return `${base}/files?folderId=${resource}`
    case 'knowledge':
      return `${base}/knowledge/${resource}`
    case 'skill':
      return `${base}/skills?skillId=${resource}`
    case 'table':
      return `${base}/tables/${resource}`
    case 'workflow':
      return `${base}/w/${resource}`
  }
}

/** Builds the canonical absolute browser URL for a navigable workspace resource. */
export function workspaceResourceWebUrl(
  baseUrl: string,
  workspaceId: string,
  kind: WorkspaceResourceKind,
  resourceId: string
): string {
  return new URL(workspaceResourcePath(workspaceId, kind, resourceId), baseUrl).toString()
}
