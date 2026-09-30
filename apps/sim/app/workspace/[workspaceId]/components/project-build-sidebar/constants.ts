import type { ComponentType } from 'react'
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
import { organizationRoutes } from '@/lib/navigation/paths'

export type ProjectSection = 'dashboard' | 'changelog' | 'issues' | 'environments'

/**
 * Href of one section of the project main view, which lives on the organization surface; a
 * workspace outside any organization has no project view, so there is none.
 */
export function projectHomeHref(
  organizationId: string | null,
  workspaceId: string,
  section: ProjectSection = 'dashboard'
): string | null {
  return organizationId ? organizationRoutes(organizationId).project(workspaceId, section) : null
}

interface ProjectNavSection {
  id: ProjectSection
  label: string
  icon: ComponentType<{ className?: string }>
}

/** The project main view's sections, top-down, as the main view's own chips read them. */
export const PROJECT_NAV_SECTIONS: readonly ProjectNavSection[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'changelog', label: 'Changelog', icon: Rss },
  { id: 'issues', label: 'Issues', icon: ListChecks },
  { id: 'environments', label: 'Environments', icon: Server },
]

export type BuildSectionId =
  | 'integrations'
  | 'workflows'
  | 'files'
  | 'logs'
  | 'tables'
  | 'knowledge'
  | 'settings'

interface BuildNavSection {
  id: BuildSectionId
  label: string
  icon: ComponentType<{ className?: string }>
  /** Path under `/workspace/<id>/` the section opens. */
  segment: string
  /** Sibling path prefixes under `/workspace/<id>/` that keep the section active. */
  activeSegments?: readonly string[]
}

/**
 * The Build sections in the order the project view lists them, which is also the order the
 * main view's Build tables and the playground's `WORKSPACE_SECTIONS` read. One constant so
 * every listing of these sections follows it.
 */
export const BUILD_NAV_SECTIONS: readonly BuildNavSection[] = [
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Integration,
    segment: 'integrations',
    activeSegments: ['skills'],
  },
  { id: 'workflows', label: 'Workflows', icon: Workflow, segment: 'w' },
  { id: 'files', label: 'Files', icon: Files, segment: 'files' },
  { id: 'logs', label: 'Logs', icon: Library, segment: 'logs' },
  { id: 'tables', label: 'Tables', icon: Table, segment: 'tables' },
  { id: 'knowledge', label: 'Knowledge', icon: Database, segment: 'knowledge' },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    segment: 'settings/general',
    activeSegments: ['settings'],
  },
]
