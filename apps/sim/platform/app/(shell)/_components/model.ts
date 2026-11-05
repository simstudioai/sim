import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

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
  action?: string
  href?: string
}

/** The optional fields are the ones only real data carries; fixtures leave them out. */
export interface ShellWorkspace {
  id: string
  name: string
  logoUrl?: string | null
  permissions?: 'admin' | 'write' | 'read' | null
  isPinned?: boolean
}

export interface ShellChat extends ShellItem {
  mode?: string
  /** Absolute when the chat opens on the legacy surface. */
  href?: string
  isActive?: boolean
  isUnread?: boolean
  isPinned?: boolean
  updatedAt?: string
}

/** `value` is absolute when the destination stays on the legacy surface. */
export interface ShellDestination {
  id: string
  label: string
  icon: IconName
  value: string
}

export interface SettingsNavItem {
  key: string
  title: string
  icon: IconName
  /** Absolute when the section stays on the legacy surface. */
  href?: string
}

export interface SettingsNavGroup {
  label: string
  items: readonly SettingsNavItem[]
}

type ShellQueryStatus = 'pending' | 'error' | 'success'

export interface ShellData {
  organization: {
    name: string
    memberCount: number
    id?: string
    slug?: string
    logo?: string | null
  }
  user: { name: string; id?: string; email?: string; image?: string | null }
  workspaces: ShellWorkspace[]
  chats: ShellChat[]
  inbox: InboxItem[]
  notifications: ShellNotice[]
  /** Shell features with no backend in this data source. Hidden, because empty would misinform. */
  unbacked?: readonly ('inbox' | 'sortWorkspaces')[]
  /** So a list can tell loading and failure from empty. Absent means the data is simply there. */
  status?: { workspaces: ShellQueryStatus; chats: ShellQueryStatus; profile: ShellQueryStatus }
  workspaceCreation?: { canCreate: boolean; organizationId: string | null; reason: string | null }
  /** Viewer standing, access, deployment and flags. Absent outside a live session. */
  surface?: PlatformOrganization
  /** The viewer's gated navigation. Absent means the static destination lists. */
  destinations?: readonly ShellDestination[]
  settingsNavigation?: readonly SettingsNavGroup[]
}
