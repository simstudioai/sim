import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export type HomeMode = 'Build' | 'Search'
export type HomeWidget = 'Activity' | 'Email' | 'Calendar'

export interface ShellItem {
  id: string
  title: string
}

export interface ShellNotice extends ShellItem {
  description?: string
  icon: IconName
  action?: string
  href?: string
}

export interface ShellWorkspace {
  id: string
  name: string
  href: string
  logoUrl?: string | null
  permissions: 'admin' | 'write' | 'read' | null
  isPinned: boolean
}

export interface ShellChat extends ShellItem {
  /** Assistant chats live under Search, agent chats at the chat route. */
  href: string
  isActive?: boolean
  isUnread?: boolean
  isPinned?: boolean
}

export interface ShellDestination {
  id: string
  label: string
  icon: IconName
  value: string
}

export type ShellQueryStatus = 'pending' | 'error' | 'success'

export interface ShellData {
  organization: { id: string; name: string; memberCount: number; logo: string | null }
  /** Absent until the viewer's profile has loaded. */
  user?: { name: string; image: string | null; canSignOut: boolean }
  workspaces: ShellWorkspace[]
  chats: ShellChat[]
  /** So a list can tell loading and failure from empty. */
  status: { workspaces: ShellQueryStatus; chats: ShellQueryStatus }
  workspaceCreation?: { canCreate: boolean; organizationId: string | null; reason: string | null }
  /** False when the viewer's chat list would be refused, so the section is not offered. */
  chatsAvailable: boolean
  destinations: readonly ShellDestination[]
}

/** A partial bulk failure still reports which chats went, so the view can narrow what is left. */
interface ChatRemoval {
  removedIds: readonly string[]
  failure?: string
}

export interface ShellChatActions {
  rename: (id: string, title: string) => Promise<void>
  remove: (ids: readonly string[]) => Promise<ChatRemoval>
  setPinned: (id: string, pinned: boolean) => void
  setRead: (id: string, read: boolean) => void
  retry: () => void
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

export interface ShellSupport {
  imageAccept: string
  requestTypes: readonly { value: string; label: string }[]
  /** Validates and compresses one image; rejects with why it cannot be attached. */
  prepareImage: (file: File) => Promise<File>
  submit: (request: ShellSupportRequest) => Promise<void>
}

export interface ShellHelp {
  openDocumentation: () => void
  joinSlack: () => void
  support: ShellSupport
  changelogUrl?: string
  downloadUrl?: string
  desktopUpdate?: { label: string; disabled: boolean; run: () => void }
}

/** What the shell's views can do, backed by the same mutations the workspace surface uses. */
export interface ShellActions {
  chats: ShellChatActions
  workspaces: ShellWorkspaceActions
  organization: ShellOrganizationActions
  help: ShellHelp
  signOut: () => void
  /** Runs `leave` now, or once the viewer agrees to discard unsaved settings. */
  requestLeave: (leave: () => void) => void
  /** Leaves through the settings guard, remembering where Settings' Back returns to. */
  navigate: (href: string) => void
}
