import { Folder, Layout, ListChecks, Rss, Server } from '@sim/emcn/icons'

/** The project main view's sections, in the order its chips read. */
export const PROJECT_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'changelog', label: 'Changelog', icon: Rss },
  { id: 'issues', label: 'Issues', icon: ListChecks },
  { id: 'resources', label: 'Resources', icon: Folder },
  { id: 'environments', label: 'Environments', icon: Server },
] as const

export type ProjectSection = (typeof PROJECT_SECTIONS)[number]['id'] | 'settings'

export function isProjectSection(value: string): value is ProjectSection {
  return value === 'settings' || PROJECT_SECTIONS.some((section) => section.id === value)
}

/** The workspace pages a project's resources open in. */
export const workspaceRoutes = {
  workflows: (workspaceId: string) => `/workspace/${workspaceId}/w`,
  workflow: (workspaceId: string, workflowId: string) =>
    `/workspace/${workspaceId}/w/${workflowId}`,
}
