import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export type HomeMode = 'Build' | 'Search'
export type HomeWidget = 'Activity' | 'Email' | 'Calendar'

export interface ShellItem {
  id: string
  title: string
}

export interface InboxItem extends ShellItem {
  description: string
  icon: IconName
  unread: boolean
  href: string
}

export interface ShellNotice extends ShellItem {
  description?: string
  icon: IconName
  action: string
  href?: string
}

export interface ShellData {
  organization: { name: string; memberCount: number }
  user: { name: string }
  workspaces: { id: string; name: string }[]
  chats: ShellItem[]
  inbox: InboxItem[]
  notifications: ShellNotice[]
}
