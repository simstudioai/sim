'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type { PresenceAvatarUser } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'

const EMPTY_OTHERS: PresenceAvatarUser[] = []
const noop = () => {}

// Split into two contexts on purpose: the roster (`others`) changes on every join/leave,
// but the setter is stable. The editor (which owns the awareness) only ever *reports* the
// roster, so it subscribes to the setter context — which never changes identity — and never
// re-renders when the roster does; only the header avatar stack subscribes to `others`.
const FileDocOthersContext = createContext<PresenceAvatarUser[]>(EMPTY_OTHERS)
const FileDocSetOthersContext = createContext<(users: PresenceAvatarUser[]) => void>(noop)

/**
 * Scopes "who's in this file" presence to the open document — the `RoomProvider` +
 * `useOthers` pattern (Liveblocks / y-presence) adapted to our component tree. The editor
 * owns the Yjs awareness but sits *below* the file-detail header that renders the avatar
 * stack, so it publishes the SERVER-AUTHENTICATED roster into this context
 * ({@link useReportFileDocOthers}) and the header reads it ({@link useFileDocOthers}).
 * Presence is ephemeral and room-scoped, so it lives in this provider, not a global store.
 */
export function FileDocRoomProvider({ children }: { children: ReactNode }) {
  const [others, setOthers] = useState<PresenceAvatarUser[]>(EMPTY_OTHERS)
  return (
    <FileDocSetOthersContext.Provider value={setOthers}>
      <FileDocOthersContext.Provider value={others}>{children}</FileDocOthersContext.Provider>
    </FileDocSetOthersContext.Provider>
  )
}

/** The roster of collaborators currently in the open file, for an avatar stack. Empty
 *  outside a {@link FileDocRoomProvider}. */
export function useFileDocOthers(): PresenceAvatarUser[] {
  return useContext(FileDocOthersContext)
}

/** Publishes the server roster into the room context (editor side). Returns a stable no-op
 *  outside a {@link FileDocRoomProvider}. */
export function useReportFileDocOthers(): (users: PresenceAvatarUser[]) => void {
  return useContext(FileDocSetOthersContext)
}
