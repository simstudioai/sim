import type { ComponentType, ReactNode } from 'react'

export interface IntegrationSearchItem {
  id: string
  name: string
  href: string
  icon: ComponentType<{ className?: string }>
  bgColor: string
}

export interface TaskItem {
  id: string
  name: string
  href: string
}

export interface WorkflowItem {
  id: string
  name: string
  href: string
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

export interface FileItem {
  id: string
  name: string
  href: string
  folderPath?: string[]
}

export interface SearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflows?: WorkflowItem[]
  workspaces?: WorkspaceItem[]
  chats?: TaskItem[]
  tables?: TaskItem[]
  files?: FileItem[]
  knowledgeBases?: TaskItem[]
  integrations?: IntegrationSearchItem[]
  connectedAccounts?: IntegrationSearchItem[]
  isOnWorkflowPage?: boolean
  isOnIntegrationsPage?: boolean
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
  '[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:h-[18px] [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:text-[var(--text-muted)]'

export const COMMAND_ITEM_CLASSNAME =
  'group mx-0.5 flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 text-left text-sm aria-selected:border-[var(--border-1)] aria-selected:bg-[var(--surface-active)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50'

function scoreMatch(value: string, search: string): number {
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
