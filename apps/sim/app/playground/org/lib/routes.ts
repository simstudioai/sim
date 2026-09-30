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

export const protoRoutes = {
  home: PROTO_BASE,
  search: `${PROTO_BASE}/search`,
  connectors: `${PROTO_BASE}/connectors`,
  /** Every chat opens on its own page with the resource panel beside it; the page 404s an unknown id. */
  chat: (chatId: string) => `${PROTO_BASE}/chat/${chatId}`,
  /** The project page: every section is a tab. */
  workspace: (workspaceId: string, section: WorkspaceSection = 'dashboard') =>
    section === 'settings'
      ? protoRoutes.settings(workspaceId)
      : `${PROTO_BASE}/p/${workspaceId}/${section}`,
  /** Settings replace the org sidebar with the settings list. */
  settings: (workspaceId: string, section: string = DEFAULT_SETTINGS_SECTION) =>
    `${PROTO_BASE}/p/${workspaceId}/settings/${section}`,
  issue: (workspaceId: string, key: string) => `${PROTO_BASE}/p/${workspaceId}/issue/${key}`,
}

export type ProtoRoute =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'connectors' }
  | { kind: 'chat'; chatId: string }
  | { kind: 'workspace'; workspaceId: string; section: WorkspaceSection; settingsSection?: string }
  | { kind: 'issue'; workspaceId: string; issueKey: string }

export function parseProtoRoute(slug: string[] | undefined): ProtoRoute | null {
  const [head, a, b, c, d] = slug ?? []
  if (!head) return { kind: 'home' }
  if (head === 'search' && !a) return { kind: 'search' }
  if (head === 'connectors' && !a) return { kind: 'connectors' }
  if (head === 'chat' && a && !b) return { kind: 'chat', chatId: a }
  if (head === 'p' && a) {
    if (b === 'issue' && c && !d) return { kind: 'issue', workspaceId: a, issueKey: c }
    if (b === 'settings' && !d) {
      const settingsSection = c ?? DEFAULT_SETTINGS_SECTION
      if (!SETTINGS_NAV.some((item) => item.id === settingsSection)) return null
      return { kind: 'workspace', workspaceId: a, section: 'settings', settingsSection }
    }
    const section = WORKSPACE_SECTIONS.find((s) => s.id === (b ?? 'dashboard'))
    if (section && !c) return { kind: 'workspace', workspaceId: a, section: section.id }
  }
  return null
}

/** The project whose settings are open, read from the path; null elsewhere. */
export function settingsProject(pathname: string | null): string | null {
  const match = pathname?.match(/\/p\/([^/]+)\/settings(?:\/|$)/)
  return match ? match[1] : null
}
