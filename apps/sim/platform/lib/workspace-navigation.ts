/** Where a server's data comes from, as far as the workspace pages are concerned. */
export type WorkspaceDataMode = 'fixture' | 'live'

/** An organization rollout flag a tab needs on, resolved on the server with the surface. */
type WorkspaceTabFlag = 'dashboards' | 'changelog' | 'workflow-tests'

/** The rollout flags the tabs depend on; a flag left out is off. */
export type WorkspaceTabFlags = Readonly<Partial<Record<WorkspaceTabFlag, boolean>>>

/**
 * The workspace's pages, in tab order, with the data modes the zone serves each from. A page with
 * no live adapter yet is fixture-only; a page built on live data alone has no fixtures.
 */
const WORKSPACE_TABS = [
  { section: 'dashboards', label: 'Dashboard', modes: ['fixture', 'live'], flag: 'dashboards' },
  { section: 'issues', label: 'Issues', modes: ['fixture'] },
  { section: 'changelog', label: 'Changelog', modes: ['fixture', 'live'], flag: 'changelog' },
  { section: 'logs', label: 'Logs', modes: ['fixture', 'live'] },
  { section: 'tables', label: 'Tables', modes: ['live'] },
  { section: 'files', label: 'Files', modes: ['live'] },
  { section: 'knowledge', label: 'Knowledge bases', modes: ['live'] },
  { section: 'workflows', label: 'Workflows', modes: ['live'] },
  { section: 'tests', label: 'Tests', modes: ['live'], flag: 'workflow-tests' },
  { section: 'settings', label: 'Settings', modes: ['fixture', 'live'] },
] as const satisfies readonly {
  section: string
  label: string
  modes: readonly WorkspaceDataMode[]
  flag?: WorkspaceTabFlag
}[]

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['section']

/**
 * The tabs a server in `mode` serves, in order. On live data a tab whose rollout flag is off is left
 * out; example data shows every tab it serves.
 */
export function workspaceTabs(mode: WorkspaceDataMode, flags: WorkspaceTabFlags = {}) {
  return WORKSPACE_TABS.filter(
    (tab) =>
      (tab.modes as readonly WorkspaceDataMode[]).includes(mode) &&
      (mode === 'fixture' || !('flag' in tab) || flags[tab.flag] === true)
  )
}

/** The page a workspace opens on: Dashboard on example data, Workflows on live data, as legacy does. */
export function workspaceHome(mode: WorkspaceDataMode): WorkspaceTab {
  return mode === 'live' ? 'workflows' : 'dashboards'
}

export function workspacePath(workspaceId: string, section: string) {
  return `/workspace/${encodeURIComponent(workspaceId)}/${section}`
}

/** The page a workspace opens on for a server's data, linked directly so no redirect sits in between. */
export function workspaceHomePath(workspaceId: string, mode: WorkspaceDataMode) {
  return workspacePath(workspaceId, workspaceHome(mode))
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
