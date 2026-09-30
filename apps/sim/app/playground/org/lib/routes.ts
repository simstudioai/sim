import {
  Database,
  Files,
  Integration,
  Layout,
  Library,
  ListChecks,
  Rss,
  Settings,
  Table,
  Workflow,
} from '@sim/emcn/icons'
import { CHATS } from '@/app/playground/org/lib/mock-data'
import { DEFAULT_SETTINGS_SECTION, SETTINGS_NAV } from '@/app/playground/org/lib/settings-nav'

export const PROTO_BASE = '/playground/org'

export const WORKSPACE_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'changelog', label: 'Changelog', icon: Rss },
  { id: 'issues', label: 'Issues', icon: ListChecks },
  { id: 'credentials', label: 'Integrations', icon: Integration },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'logs', label: 'Logs', icon: Library },
  { id: 'tables', label: 'Tables', icon: Table },
  { id: 'knowledge', label: 'Knowledge', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]['id']

/** What the main project view shows as chips; everything else lives in the full view. */
export const MAIN_SECTION_IDS: readonly WorkspaceSection[] = ['dashboard', 'changelog', 'issues']
export const MAIN_SECTIONS = WORKSPACE_SECTIONS.filter((s) => MAIN_SECTION_IDS.includes(s.id))

function isMainSection(section: WorkspaceSection): boolean {
  return MAIN_SECTION_IDS.includes(section)
}

export const protoRoutes = {
  home: PROTO_BASE,
  search: `${PROTO_BASE}/search`,
  connectors: `${PROTO_BASE}/connectors`,
  /** Every chat opens on its own page with the resource panel beside it. */
  chat: (chatId: string) => {
    if (!CHATS.some((c) => c.id === chatId)) throw new Error(`Unknown chat ${chatId}`)
    return `${PROTO_BASE}/chat/${chatId}`
  },
  /** Main project view for dashboard/changelog/issues; any other section opens the full view. */
  workspace: (workspaceId: string, section: WorkspaceSection = 'dashboard') =>
    isMainSection(section)
      ? `${PROTO_BASE}/p/${workspaceId}/${section}`
      : `${PROTO_BASE}/p/${workspaceId}/build/${section}`,
  /** Settings replace the project sidebar with the settings list. */
  settings: (workspaceId: string, section: string = DEFAULT_SETTINGS_SECTION) =>
    `${PROTO_BASE}/p/${workspaceId}/build/settings/${section}`,
  /** Full view: the sidebar becomes this project's navigation. */
  full: (workspaceId: string, section: WorkspaceSection = 'dashboard') =>
    `${PROTO_BASE}/p/${workspaceId}/build/${section}`,
  issue: (workspaceId: string, key: string) => `${PROTO_BASE}/p/${workspaceId}/issue/${key}`,
}

export type ProtoRoute =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'connectors' }
  | { kind: 'chat'; chatId: string }
  | {
      kind: 'workspace'
      workspaceId: string
      section: WorkspaceSection
      full: boolean
      settingsSection?: string
    }
  | { kind: 'issue'; workspaceId: string; issueKey: string }

export function parseProtoRoute(slug: string[] | undefined): ProtoRoute | null {
  const [head, a, b, c, d] = slug ?? []
  if (!head) return { kind: 'home' }
  if (head === 'search' && !a) return { kind: 'search' }
  if (head === 'connectors' && !a) return { kind: 'connectors' }
  if (head === 'chat' && a && !b) return { kind: 'chat', chatId: a }
  if (head === 'p' && a) {
    if (b === 'issue' && c) return { kind: 'issue', workspaceId: a, issueKey: c }
    if (b === 'build' && c === 'settings') {
      const settingsSection = d ?? DEFAULT_SETTINGS_SECTION
      if (!SETTINGS_NAV.some((item) => item.id === settingsSection)) return null
      return { kind: 'workspace', workspaceId: a, section: 'settings', full: true, settingsSection }
    }
    if (b === 'build') {
      const section = WORKSPACE_SECTIONS.find((s) => s.id === (c ?? 'dashboard'))
      if (section) return { kind: 'workspace', workspaceId: a, section: section.id, full: true }
      return null
    }
    const section = WORKSPACE_SECTIONS.find((s) => s.id === (b ?? 'dashboard'))
    if (section && isMainSection(section.id) && !c)
      return { kind: 'workspace', workspaceId: a, section: section.id, full: false }
  }
  return null
}

/** The project whose full view is open, read from the path; null in the org view. */
export function fullViewProject(pathname: string | null): string | null {
  const match = pathname?.match(/\/p\/([^/]+)\/build(?:\/|$)/)
  return match ? match[1] : null
}

/** The project whose settings are open, read from the path; null elsewhere. */
export function settingsProject(pathname: string | null): string | null {
  const match = pathname?.match(/\/p\/([^/]+)\/build\/settings(?:\/|$)/)
  return match ? match[1] : null
}
