'use client'

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import type { PresenceAvatarUser } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'

interface FileDocRoomContextValue {
  others: PresenceAvatarUser[]
  setOthers: (users: PresenceAvatarUser[]) => void
}

const FileDocRoomContext = createContext<FileDocRoomContextValue | null>(null)

const EMPTY_OTHERS: PresenceAvatarUser[] = []
const noop = () => {}

/**
 * Scopes "who's in this file" presence to the open document — the `RoomProvider` +
 * `useOthers` pattern (Liveblocks / y-presence) adapted to our component tree. The editor
 * owns the Yjs awareness but sits *below* the file-detail header that renders the avatar
 * stack, so the editor publishes the awareness-derived roster into this context
 * ({@link useReportFileDocOthers}) and the header reads it ({@link useFileDocOthers}).
 * Presence is ephemeral and room-scoped, so it lives in this provider, not a global store.
 */
export function FileDocRoomProvider({ children }: { children: ReactNode }) {
  const [others, setOthers] = useState<PresenceAvatarUser[]>(EMPTY_OTHERS)
  const value = useMemo(() => ({ others, setOthers }), [others])
  return <FileDocRoomContext.Provider value={value}>{children}</FileDocRoomContext.Provider>
}

/** The roster of collaborators currently in the open file, for an avatar stack. Empty
 *  outside a {@link FileDocRoomProvider}. */
export function useFileDocOthers(): PresenceAvatarUser[] {
  return useContext(FileDocRoomContext)?.others ?? EMPTY_OTHERS
}

/** Publishes the awareness-derived roster into the room context (editor side). Returns a
 *  stable no-op outside a {@link FileDocRoomProvider}. */
export function useReportFileDocOthers(): (users: PresenceAvatarUser[]) => void {
  return useContext(FileDocRoomContext)?.setOthers ?? noop
}
