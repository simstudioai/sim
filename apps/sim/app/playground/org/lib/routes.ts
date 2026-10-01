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

/** Tabs of the workspace pane; every other section lives under Resources. */
export const MAIN_SECTION_IDS: readonly WorkspaceSection[] = ['dashboard', 'changelog', 'issues']
export const MAIN_SECTIONS = WORKSPACE_SECTIONS.filter((s) => MAIN_SECTION_IDS.includes(s.id))
export const RESOURCE_SECTIONS = WORKSPACE_SECTIONS.filter((s) => !MAIN_SECTION_IDS.includes(s.id))

/** A section of the workspace pane, or the Resources tab listing the rest. */
export type ProjectSection = WorkspaceSection | 'resources'

/**
 * Everything lives beside a chat, so a link to a project thing is a `?open=` ref the chat
 * surface reads once and turns into the workspace tab or a resource tab.
 */
export const protoRoutes = {
  home: PROTO_BASE,
  search: `${PROTO_BASE}/search`,
  connectors: `${PROTO_BASE}/connectors`,
  /** Every chat opens on its own page with the workspace pane beside it; the page 404s an unknown id. */
  chat: (chatId: string) => `${PROTO_BASE}/chat/${chatId}`,
  /** Home, with `section` of the project open in the workspace tab. */
  workspace: (workspaceId: string, section: ProjectSection = 'dashboard') =>
    `${PROTO_BASE}?open=workspace:${workspaceId}:${section}`,
  /** Opens the issue as a resource tab. */
  issue: (workspaceId: string, key: string) => `?open=issues:${workspaceId}:${key}`,
}

export type ProtoRoute =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'connectors' }
  | { kind: 'chat'; chatId: string }

export function parseProtoRoute(slug: string[] | undefined): ProtoRoute | null {
  const [head, a, b] = slug ?? []
  if (!head) return { kind: 'home' }
  if (head === 'search' && !a) return { kind: 'search' }
  if (head === 'connectors' && !a) return { kind: 'connectors' }
  if (head === 'chat' && a && !b) return { kind: 'chat', chatId: a }
  return null
}
