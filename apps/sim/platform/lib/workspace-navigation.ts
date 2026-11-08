/** Where a server's data comes from, as far as the workspace pages are concerned. */
export type WorkspaceDataMode = 'fixture' | 'live'

/**
 * The workspace's pages, in tab order, with the data modes the zone serves each from. A page with
 * no live adapter yet is fixture-only; a page built on live data alone has no fixtures.
 */
export const WORKSPACE_TABS = [
  { section: 'dashboards', label: 'Dashboard', modes: ['fixture', 'live'] },
  { section: 'issues', label: 'Issues', modes: ['fixture'] },
  { section: 'changelog', label: 'Changelog', modes: ['fixture', 'live'] },
  { section: 'logs', label: 'Logs', modes: ['fixture', 'live'] },
  { section: 'tables', label: 'Tables', modes: ['live'] },
  { section: 'files', label: 'Files', modes: ['live'] },
  { section: 'knowledge', label: 'Knowledge bases', modes: ['live'] },
  { section: 'workflows', label: 'Workflows', modes: ['live'] },
  { section: 'settings', label: 'Settings', modes: ['fixture', 'live'] },
] as const satisfies readonly {
  section: string
  label: string
  modes: readonly WorkspaceDataMode[]
}[]

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['section']

/** The tabs a server in `mode` serves, in order. */
export function workspaceTabs(mode: WorkspaceDataMode) {
  return WORKSPACE_TABS.filter((tab) => (tab.modes as readonly WorkspaceDataMode[]).includes(mode))
}

/** The page a workspace opens on: Dashboard on example data, Workflows on live data, as legacy does. */
export function workspaceHome(mode: WorkspaceDataMode): WorkspaceTab {
  return mode === 'live' ? 'workflows' : 'dashboards'
}

export function workspacePath(workspaceId: string, section: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}/${section}`
}

/** A workspace itself; its route opens the page `workspaceHome` names for the server's data. */
export function workspaceEntry(workspaceId: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}`
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
