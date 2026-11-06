import type { ShellDestination, ShellItem, ShellQueryStatus } from '@/platform/shared/shell'

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
  isActive: boolean
  isUnread: boolean
  isPinned: boolean
}

export interface ShellData {
  organization: { id: string; name: string; memberCount: number; logo: string | null }
  /** Absent until the viewer's profile has loaded. */
  user?: { name: string; image: string | null; canSignOut: boolean }
  workspaces: ShellWorkspace[]
  chats: ShellChat[]
  /** So a list can tell loading and failure from empty. */
  status: { workspaces: ShellQueryStatus; chats: ShellQueryStatus }
  workspaceCreation: { canCreate: boolean; reason: string | null }
  /** False when the viewer's chat list would be refused, so the section is not offered. */
  chatsAvailable: boolean
  destinations: readonly ShellDestination[]
}

/** Leaving the current page. Each goes through the settings guard, so a draft is never lost. */
export interface ShellActions {
  signOut: () => void
  /** Runs `leave` now, or once the viewer agrees to discard unsaved settings. */
  requestLeave: (leave: () => void) => void
  /** Also remembers where Settings' Back returns to. */
  navigate: (href: string) => void
}
