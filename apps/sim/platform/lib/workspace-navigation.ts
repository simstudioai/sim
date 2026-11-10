import { workspacePath } from '@/lib/navigation/paths'
import { platformHref } from '@/platform/lib/navigation'
/** Where a server's data comes from, as far as the workspace pages are concerned. */
export type WorkspaceDataMode = 'fixture' | 'live'

/**
 * A runtime flag the tabs depend on, resolved on the server with the surface: a tab's own rollout
 * flag, or `platform-preview`, which shows the tabs held for their design pass.
 */
type WorkspaceTabFlag = 'dashboards' | 'changelog' | 'workflow-tests' | 'platform-preview'

/** The flags the tabs depend on; a flag left out is off. */
export type WorkspaceTabFlags = Readonly<Partial<Record<WorkspaceTabFlag, boolean>>>

/**
 * The workspace's pages, in tab order, with the data modes the zone serves each from. A page with
 * no live adapter yet is fixture-only; a page built on live data alone has no fixtures. A `preview`
 * page waits for its design pass: its route and views stay, and live data lists it only while the
 * `platform-preview` flag is on.
 */
const WORKSPACE_TABS = [
  {
    section: 'dashboards',
    label: 'Dashboard',
    modes: ['fixture', 'live'],
    flag: 'dashboards',
    preview: true,
  },
  { section: 'issues', label: 'Issues', modes: ['fixture'], preview: true },
  {
    section: 'changelog',
    label: 'Changelog',
    modes: ['fixture', 'live'],
    flag: 'changelog',
    preview: true,
  },
  { section: 'logs', label: 'Logs', modes: ['fixture', 'live'] },
  { section: 'tables', label: 'Tables', modes: ['live'] },
  { section: 'files', label: 'Files', modes: ['live'] },
  { section: 'knowledge', label: 'Knowledge bases', modes: ['live'] },
  { section: 'workflows', label: 'Workflows', modes: ['live'] },
  { section: 'tests', label: 'Tests', modes: ['live'], flag: 'workflow-tests', preview: true },
  { section: 'settings', label: 'Settings', modes: ['fixture', 'live'] },
] as const satisfies readonly {
  section: string
  label: string
  modes: readonly WorkspaceDataMode[]
  flag?: WorkspaceTabFlag
  preview?: boolean
}[]

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['section']

/**
 * The tabs a server in `mode` serves, in order. On live data a tab whose rollout flag is off is left
 * out, and so is a preview tab while `platform-preview` is off; example data shows every tab it
 * serves.
 */
export function workspaceTabs(mode: WorkspaceDataMode, flags: WorkspaceTabFlags = {}) {
  return WORKSPACE_TABS.filter(
    (tab) =>
      (tab.modes as readonly WorkspaceDataMode[]).includes(mode) &&
      (mode === 'fixture' ||
        ((!('preview' in tab) || flags['platform-preview'] === true) &&
          (!('flag' in tab) || flags[tab.flag as WorkspaceTabFlag] === true)))
  )
}

/**
 * Whether live data lists `section` for these flags. Nothing on live data links or opens into a tab
 * it does not list, so the same flags restore every entry point at once.
 */
export function isWorkspaceTabShown(section: WorkspaceTab, flags: WorkspaceTabFlags): boolean {
  return workspaceTabs('live', flags).some((tab) => tab.section === section)
}

/** The page a workspace opens on: Dashboard on example data, Workflows on live data, as legacy does. */
function workspaceHome(mode: WorkspaceDataMode): WorkspaceTab {
  return mode === 'live' ? 'workflows' : 'dashboards'
}

/** The page a workspace opens on for a server's data, linked directly so no redirect sits in between. */
export function workspaceHomePath(workspaceId: string, mode: WorkspaceDataMode) {
  return workspacePath(workspaceId, workspaceHome(mode))
}

/**
 * Where a workspace's bare URL redirects: its home page, keeping the query it was opened with on
 * live data and the scenario query on example data.
 */
export function workspaceRootHref(
  workspaceId: string,
  mode: WorkspaceDataMode,
  query: URLSearchParams
) {
  const home = workspaceHomePath(workspaceId, mode)
  if (mode === 'fixture') return platformHref(home, query)
  return query.size ? `${home}?${query}` : home
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
