import type { IconName } from '@sim/emcn/catalog/icon-geometry'

export function workspacePath(workspaceId: string, section: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}/${section}`
}

export function workspaceEntry(workspaceId: string) {
  return workspacePath(workspaceId, 'chat')
}

export function chatPath(chatId?: string, workspaceId?: string) {
  const base = workspaceId ? workspaceEntry(workspaceId) : '/chat'
  return chatId ? `${base}/${encodeURIComponent(chatId)}` : base
}

/** Resources the isolated legacy preview document still renders in the workspace pane. */
export const WORKSPACE_PAGES = [
  { section: 'tables', label: 'Tables', icon: 'I033' },
  { section: 'files', label: 'Files', icon: 'I015' },
  { section: 'knowledge', label: 'Knowledge bases', icon: 'I004' },
  { section: 'tests', label: 'Tests', icon: 'I072' },
] as const satisfies readonly { section: string; label: string; icon: IconName }[]

/** The workspace's own Platform pages, in tab order. */
export const WORKSPACE_TABS = [
  { section: 'dashboards', label: 'Dashboard', icon: 'I038' },
  { section: 'issues', label: 'Issues', icon: 'I073' },
  { section: 'changelog', label: 'Changelog', icon: 'I046' },
  { section: 'logs', label: 'Logs', icon: 'I082' },
] as const satisfies readonly { section: string; label: string; icon: IconName }[]

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['section']

export function isWorkspaceTab(section: string | undefined): section is WorkspaceTab {
  return WORKSPACE_TABS.some((tab) => tab.section === section)
}

export function workspaceLocation(pathname: string) {
  const [, root, id, section, detail] = pathname.split('/')
  if (root !== 'workspace' || !id) return null
  try {
    return { id: decodeURIComponent(id), section: section || 'chat', detail }
  } catch {
    return null
  }
}
