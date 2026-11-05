import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import type { Appearance } from '@/platform/design-system/navigation'
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
  /** Absolute: a workspace opens on the legacy surface. */
  href?: string
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

export type ShellQueryStatus = 'pending' | 'error' | 'success'

export interface ShellData {
  /** The viewer's saved theme. Live sessions set it; fixtures read `?theme=` instead. */
  appearance?: Appearance
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
  /** Rows the Workspaces section shows before See more. Absent means every row. */
  workspacePageSize?: number
  /** False when the viewer's chat list would be refused, so the section is not offered. */
  chatsAvailable?: boolean
  /** Absent outside a live session. */
  surface?: PlatformOrganization
  /** The viewer's gated navigation. Absent means the static destination lists. */
  destinations?: readonly ShellDestination[]
  settingsNavigation?: readonly SettingsNavGroup[]
}

/** A partial bulk failure still reports which chats went, so the view can narrow what is left. */
interface ChatRemoval {
  removedIds: readonly string[]
  failure?: string
}

/** The optional members are the ones only a real backend can honour. */
export interface ShellChatActions {
  removeLabel: 'Archive' | 'Delete'
  /** What happens to removed chats, when there is more to say than the label. */
  removeDetail?: (count: number) => string
  rename: (id: string, title: string) => Promise<void>
  remove: (ids: readonly string[]) => Promise<ChatRemoval>
  setPinned?: (id: string, pinned: boolean) => void
  setRead?: (id: string, read: boolean) => void
  /** Reads a chat ahead of an intended open. Returns how to call it off. */
  prefetch?: (chat: ShellChat) => () => void
  retry?: () => void
}

export interface ShellWorkspaceActions {
  /** Resolves with where the new workspace opens. */
  create: (name: string) => Promise<string>
  rename: (id: string, name: string) => Promise<void>
  setPinned: (id: string, pinned: boolean) => void
  retry: () => void
}

export interface ShellOrganizationActions {
  canEditIdentity: boolean
  canInvite: boolean
  logoAccept: string
  rename: (name: string) => Promise<void>
  uploadLogo: (file: File) => Promise<void>
}

interface ShellSupportRequest {
  type: string
  subject: string
  message: string
  images: readonly File[]
}

export type ShellSupport =
  | { email: string; submit?: never }
  | {
      email?: never
      imageAccept: string
      requestTypes: readonly { value: string; label: string }[]
      /** Validates and compresses one image; rejects with why it cannot be attached. */
      prepareImage: (file: File) => Promise<File>
      submit: (request: ShellSupportRequest) => Promise<void>
    }

export interface ShellHelp {
  documentationUrl: string
  support: ShellSupport
  slackUrl?: string
  changelogUrl?: string
  downloadUrl?: string
  desktopUpdate?: { label: string; disabled: boolean; run: () => void }
}

/**
 * What the shell's views can do, filled by session state on fixtures and by mutations on live data.
 * A view offers a control only when its action exists here.
 */
export interface ShellActions {
  chats: ShellChatActions
  workspaces?: ShellWorkspaceActions
  organization?: ShellOrganizationActions
  /** Absent for the anonymous viewer of an auth-disabled deployment, who cannot sign out. */
  signOut?: () => void
  help: ShellHelp
  /** Runs `leave` now, or once the viewer agrees to discard unsaved settings. */
  requestLeave: (leave: () => void) => void
  /** Where Back to app goes, given the last page seen outside Settings. */
  settingsReturn: (entry: string | null) => string
}
