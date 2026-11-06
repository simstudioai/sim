import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

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

export const WORKSPACE_PAGES = [
  { section: 'tables', label: 'Tables', icon: 'I033' },
  { section: 'files', label: 'Files', icon: 'I015' },
  { section: 'knowledge', label: 'Knowledge bases', icon: 'I004' },
  { section: 'tests', label: 'Tests', icon: 'I072' },
  { section: 'logs', label: 'Logs', icon: 'I082' },
  { section: 'dashboards', label: 'Dashboard', icon: 'I038' },
  { section: 'changelog', label: 'Changelog', icon: 'I046' },
] as const satisfies readonly { section: string; label: string; icon: IconName }[]

export function workspaceLocation(pathname: string) {
  const [, root, id, section, detail] = pathname.split('/')
  if (root !== 'workspace' || !id) return null
  try {
    return { id: decodeURIComponent(id), section: section || 'chat', detail }
  } catch {
    return null
  }
}
