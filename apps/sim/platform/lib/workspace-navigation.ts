/** The workspace's pages, in tab order. A workspace opens on the first. */
export const WORKSPACE_TABS = [
  { section: 'dashboards', label: 'Dashboard' },
  { section: 'issues', label: 'Issues' },
  { section: 'changelog', label: 'Changelog' },
  { section: 'logs', label: 'Logs' },
] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['section']

export function workspacePath(workspaceId: string, section: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}/${section}`
}

export function workspaceEntry(workspaceId: string) {
  return workspacePath(workspaceId, WORKSPACE_TABS[0].section)
}

/** The workspace a path is under, and the record it shows, if any. */
export function workspaceLocation(pathname: string) {
  const [, root, id, , detail] = pathname.split('/')
  if (root !== 'workspace' || !id) return null
  try {
    return { id: decodeURIComponent(id), detail }
  } catch {
    return null
  }
}
