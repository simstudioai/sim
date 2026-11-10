import { workspacePath } from '@/lib/navigation/paths'
import { platformHref } from '@/platform/lib/navigation'
/** Where a server's data comes from, as far as the workspace pages are concerned. */
export type WorkspaceDataMode = 'fixture' | 'live'

/** An organization rollout flag a tab needs on, resolved on the server with the surface. */
type WorkspaceTabFlag = 'dashboards' | 'changelog' | 'workflow-tests'

/** The rollout flags the tabs depend on; a flag left out is off. */
export type WorkspaceTabFlags = Readonly<Partial<Record<WorkspaceTabFlag, boolean>>>

/**
 * The workspace's pages, in tab order, with the data modes the zone serves each from. A page with
 * no live adapter yet is fixture-only; a page built on live data alone has no fixtures. A `hidden`
 * page is held back by design until the designer's pass: its route and views stay, but no live tab
 * lists it.
 */
const WORKSPACE_TABS = [
  {
    section: 'dashboards',
    label: 'Dashboard',
    modes: ['fixture', 'live'],
    flag: 'dashboards',
    hidden: true,
  },
  { section: 'issues', label: 'Issues', modes: ['fixture'], hidden: true },
  {
    section: 'changelog',
    label: 'Changelog',
    modes: ['fixture', 'live'],
    flag: 'changelog',
    hidden: true,
  },
  { section: 'logs', label: 'Logs', modes: ['fixture', 'live'] },
  { section: 'tables', label: 'Tables', modes: ['live'] },
  { section: 'files', label: 'Files', modes: ['live'] },
  { section: 'knowledge', label: 'Knowledge bases', modes: ['live'] },
  { section: 'workflows', label: 'Workflows', modes: ['live'] },
  { section: 'tests', label: 'Tests', modes: ['live'], flag: 'workflow-tests', hidden: true },
  { section: 'settings', label: 'Settings', modes: ['fixture', 'live'] },
] as const satisfies readonly {
  section: string
  label: string
  modes: readonly WorkspaceDataMode[]
  flag?: WorkspaceTabFlag
  hidden?: boolean
}[]

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['section']

/**
 * The tabs a server in `mode` serves, in order. On live data a hidden tab, and a tab whose rollout
 * flag is off, is left out; example data shows every tab it serves.
 */
export function workspaceTabs(mode: WorkspaceDataMode, flags: WorkspaceTabFlags = {}) {
  return WORKSPACE_TABS.filter(
    (tab) =>
      (tab.modes as readonly WorkspaceDataMode[]).includes(mode) &&
      (mode === 'fixture' ||
        (!('hidden' in tab) && (!('flag' in tab) || flags[tab.flag as WorkspaceTabFlag] === true)))
  )
}

/**
 * Whether live data holds `section` back by design. Nothing on live data links or opens into a
 * hidden tab, so un-hiding it in `WORKSPACE_TABS` restores every entry point at once.
 */
export function isWorkspaceTabHidden(section: WorkspaceTab): boolean {
  return WORKSPACE_TABS.some((tab) => tab.section === section && 'hidden' in tab && tab.hidden)
}

/** The page a workspace opens on: Dashboard on example data, Workflows on live data, as legacy does. */
function workspaceHome(mode: WorkspaceDataMode): WorkspaceTab {
  return mode === 'live' ? 'workflows' : 'dashboards'
}

/** The page a workspace opens on for a server's data, linked directly so no redirect sits in between. */
export function workspaceHomePath(workspaceId: string, mode: WorkspaceDataMode) {
  return workspacePath(workspaceId, workspaceHome(mode))
}

/** Where a workspace's bare URL redirects: its home page, with the fixture query kept. */
export function workspaceRootHref(
  workspaceId: string,
  mode: WorkspaceDataMode,
  search: Parameters<typeof platformHref>[1]
) {
  return platformHref(workspaceHomePath(workspaceId, mode), search)
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
