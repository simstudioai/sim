import { CHATS } from '@/app/playground/org/lib/mock-data'
export const PROTO_BASE = '/playground/org'

import {
  Database,
  Files,
  Integration,
  Layout,
  Library,
  Rss,
  Settings,
  Table,
  Workflow,
} from '@sim/emcn/icons'

export const WORKSPACE_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'changelog', label: 'Changelog', icon: Rss },
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
  /** Project chats slide in beside their project; org-level chats open on their own page. */
  chat: (chatId: string) => {
    const chat = CHATS.find((c) => c.id === chatId)
    if (!chat) throw new Error(`Unknown chat ${chatId}`)
    return chat.workspaceId
      ? `${PROTO_BASE}/p/${chat.workspaceId}/changelog?chat=${chatId}`
      : `${PROTO_BASE}/chat/${chatId}`
  },
  workspace: (workspaceId: string, section: WorkspaceSection = 'changelog') =>
    `${PROTO_BASE}/p/${workspaceId}/${section}`,
  issue: (workspaceId: string, key: string) => `${PROTO_BASE}/p/${workspaceId}/issue/${key}`,
}

export type ProtoRoute =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'connectors' }
  | { kind: 'chat'; chatId: string }
  | { kind: 'workspace'; workspaceId: string; section: WorkspaceSection }
  | { kind: 'issue'; workspaceId: string; issueKey: string }

export function parseProtoRoute(slug: string[] | undefined): ProtoRoute | null {
  const [head, a, b, c] = slug ?? []
  if (!head) return { kind: 'home' }
  if (head === 'search' && !a) return { kind: 'search' }
  if (head === 'connectors' && !a) return { kind: 'connectors' }
  if (head === 'chat' && a && !b) return { kind: 'chat', chatId: a }
  if (head === 'p' && a) {
    if (b === 'issue' && c) return { kind: 'issue', workspaceId: a, issueKey: c }
    const section = WORKSPACE_SECTIONS.find((s) => s.id === (b ?? 'changelog'))
    if (section && !c) return { kind: 'workspace', workspaceId: a, section: section.id }
  }
  return null
}
