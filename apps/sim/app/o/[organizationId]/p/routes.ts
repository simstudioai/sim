import { Branch, Folder, Layout, ListChecks, Rss, Settings } from '@sim/emcn/icons'

/** The project main view's sections, in the order its tabs read. */
export const PROJECT_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'changelog', label: 'Changelog', icon: Rss },
  { id: 'issues', label: 'Issues', icon: ListChecks },
  { id: 'resources', label: 'Resources', icon: Folder },
  { id: 'environments', label: 'Environments', icon: Branch },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

export type ProjectSection = (typeof PROJECT_SECTIONS)[number]['id']

export function isProjectSection(value: string): value is ProjectSection {
  return PROJECT_SECTIONS.some((section) => section.id === value)
}
