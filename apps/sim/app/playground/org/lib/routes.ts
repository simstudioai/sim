import {
  Database,
  Files,
  Integration,
  Layout,
  Library,
  ListChecks,
  Rss,
  Server,
  Settings,
  Table,
  Workflow,
} from '@sim/emcn/icons'
import {
  getWorkspaceSettingsHref,
  type WorkspaceSettingsSection,
} from '@/components/settings/navigation'
import { MOCK_PROJECT_IDS, type Project } from '@/app/playground/org/lib/project'
import { DEFAULT_SETTINGS_SECTION, SETTINGS_NAV } from '@/app/playground/org/lib/settings-nav'

export const PROTO_BASE = '/playground/org'

export const WORKSPACE_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'changelog', label: 'Changelog', icon: Rss },
  { id: 'issues', label: 'Issues', icon: ListChecks },
  { id: 'environments', label: 'Environments', icon: Server },
  { id: 'credentials', label: 'Integrations', icon: Integration },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'logs', label: 'Logs', icon: Library },
  { id: 'tables', label: 'Tables', icon: Table },
  { id: 'knowledge', label: 'Knowledge', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]['id']

const MAIN_SECTION_LIST = ['dashboard', 'changelog', 'issues', 'environments'] as const

/** A section of the project main view. */
export type MainSection = (typeof MAIN_SECTION_LIST)[number]
/** A Build section: a real workspace page, or a mock project's static table. */
export type BuildSection = Exclude<WorkspaceSection, MainSection>

/** What the main project view shows as chips; everything else lives in Build. */
export const MAIN_SECTION_IDS: readonly WorkspaceSection[] = MAIN_SECTION_LIST
export const MAIN_SECTIONS = WORKSPACE_SECTIONS.filter((s) => MAIN_SECTION_IDS.includes(s.id))
export const BUILD_SECTION_IDS: readonly BuildSection[] = WORKSPACE_SECTIONS.map(
  (s) => s.id
).filter((id): id is BuildSection => !isMainSection(id))

export function isMainSection(section: WorkspaceSection): section is MainSection {
  return (MAIN_SECTION_LIST as readonly WorkspaceSection[]).includes(section)
}

export const protoRoutes = {
  home: PROTO_BASE,
  search: `${PROTO_BASE}/search`,
  connectors: `${PROTO_BASE}/connectors`,
  /** Project chats slide in beside their project; org-level chats open on their own page. */
  chat: (workspaceId: string | null, chatId: string) =>
    workspaceId
      ? `${PROTO_BASE}/p/${workspaceId}/dashboard?chat=${chatId}`
      : `${PROTO_BASE}/chat/${chatId}`,
  /** Main project view for dashboard/changelog/issues; any other section opens the full view. */
  workspace: (workspaceId: string, section: WorkspaceSection = 'dashboard') =>
    isMainSection(section)
      ? `${PROTO_BASE}/p/${workspaceId}/${section}`
      : `${PROTO_BASE}/p/${workspaceId}/build/${section}`,
  /** Mock projects only: settings replace the project sidebar with the settings list. */
  settings: (workspaceId: string, section: string = DEFAULT_SETTINGS_SECTION) =>
    `${PROTO_BASE}/p/${workspaceId}/build/settings/${section}`,
  /**
   * Mock projects only: the playground's static Build tables, with the sidebar as the
   * project's navigation. A real project's Build sections are its workspace pages.
   */
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
    if (b === 'build') {
      /** Only a mock project builds here; a real project's Build sections are its workspace pages. */
      if (!MOCK_PROJECT_IDS.has(a)) return null
      if (c === 'settings') {
        const settingsSection = d ?? DEFAULT_SETTINGS_SECTION
        if (!SETTINGS_NAV.some((item) => item.id === settingsSection)) return null
        return {
          kind: 'workspace',
          workspaceId: a,
          section: 'settings',
          full: true,
          settingsSection,
        }
      }
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

/** The mock project whose full view is open, read from the path; null in the org view. */
export function fullViewProject(pathname: string | null): string | null {
  const match = pathname?.match(/\/p\/([^/]+)\/build(?:\/|$)/)
  return match ? match[1] : null
}

/** The mock project whose settings are open, read from the path; null elsewhere. */
export function settingsProject(pathname: string | null): string | null {
  const match = pathname?.match(/\/p\/([^/]+)\/build\/settings(?:\/|$)/)
  return match ? match[1] : null
}

/** The real workspace pages a project's resources open in. */
export const workspaceRoutes = {
  workflows: (workspaceId: string) => `/workspace/${workspaceId}/w`,
  workflow: (workspaceId: string, workflowId: string) =>
    `/workspace/${workspaceId}/w/${workflowId}`,
  files: (workspaceId: string) => `/workspace/${workspaceId}/files`,
  file: (workspaceId: string, fileId: string) => `/workspace/${workspaceId}/files/${fileId}`,
  tables: (workspaceId: string) => `/workspace/${workspaceId}/tables`,
  table: (workspaceId: string, tableId: string) => `/workspace/${workspaceId}/tables/${tableId}`,
  knowledge: (workspaceId: string) => `/workspace/${workspaceId}/knowledge`,
  knowledgeBase: (workspaceId: string, id: string) => `/workspace/${workspaceId}/knowledge/${id}`,
  logs: (workspaceId: string, executionId?: string | null) =>
    executionId
      ? `/workspace/${workspaceId}/logs?executionId=${encodeURIComponent(executionId)}`
      : `/workspace/${workspaceId}/logs`,
  integrations: (workspaceId: string) => `/workspace/${workspaceId}/integrations`,
  credential: (workspaceId: string, credentialId: string) =>
    `/workspace/${workspaceId}/integrations/connected/${credentialId}`,
  settings: (workspaceId: string, section: WorkspaceSettingsSection) =>
    getWorkspaceSettingsHref(workspaceId, section),
  /** The settings page every workspace has; `/settings` itself redirects here. */
  settingsHome: (workspaceId: string) => `/workspace/${workspaceId}/settings/general`,
}

const BUILD_PAGES: Record<BuildSection, (workspaceId: string) => string> = {
  credentials: workspaceRoutes.integrations,
  workflows: workspaceRoutes.workflows,
  files: workspaceRoutes.files,
  logs: (workspaceId) => workspaceRoutes.logs(workspaceId),
  tables: workspaceRoutes.tables,
  knowledge: workspaceRoutes.knowledge,
  settings: workspaceRoutes.settingsHome,
}

/**
 * Where a project's Build section opens: the real workspace page, or, for a mock project with
 * no workspace behind it, the playground's static table.
 */
export function buildSectionHref(
  project: Pick<Project, 'id' | 'isMock'>,
  section: BuildSection
): string {
  return project.isMock ? protoRoutes.full(project.id, section) : BUILD_PAGES[section](project.id)
}
