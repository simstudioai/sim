import type { ComponentType, ReactNode } from 'react'

export interface TaskItem {
  id: string
  name: string
  href: string
}

export interface WorkflowItem {
  id: string
  name: string
  href: string
  color: string
  folderPath?: string[]
  isCurrent?: boolean
}

export interface WorkspaceItem {
  id: string
  name: string
  href: string
  isCurrent?: boolean
}

export interface PageItem {
  id: string
  name: string
  icon: ComponentType<{ className?: string }>
  href?: string
  onClick?: () => void
  shortcut?: string
  hidden?: boolean
}

export interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  tasks?: TaskItem[]
  tables?: TaskItem[]
  files?: TaskItem[]
  knowledgeBases?: TaskItem[]
  isOnWorkflowPage?: boolean
}

export interface CommandItemProps {
  value: string
  onSelect: () => void
  icon: ComponentType<{ className?: string }>
  bgColor: string
  showColoredIcon?: boolean
  children: ReactNode
}

export const GROUP_HEADING_CLASSNAME =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-0.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:font-base [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-[var(--text-icon)]'

export const COMMAND_ITEM_CLASSNAME =
  'group flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 text-left text-sm aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-5)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 dark:aria-selected:bg-[var(--surface-4)]'

export function scoreMatch(value: string, search: string): number {
  if (!search) return 1
  const valueLower = value.toLowerCase()
  const searchLower = search.toLowerCase()

  if (valueLower === searchLower) return 1
  if (valueLower.startsWith(searchLower)) return 0.9
  if (valueLower.includes(searchLower)) return 0.7

  const words = searchLower.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    if (words.every((w) => valueLower.includes(w))) return 0.5
  }

  return 0
}

export function filterAndSort<T>(items: T[], toValue: (item: T) => string, search: string): T[] {
  if (!search) return items
  const scored: [T, number][] = []
  for (const item of items) {
    const s = scoreMatch(toValue(item), search)
    if (s > 0) scored.push([item, s])
  }
  scored.sort((a, b) => b[1] - a[1])
  return scored.map(([item]) => item)
}
