'use client'

import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { FlushFileDocResult } from '@sim/realtime-protocol/file-doc'
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
 * The open document's flush, or `null` when nothing collaborative is mounted.
 *
 * Same publish-upward direction as the roster, and for the same reason: the editor owns the realtime
 * provider but sits below the file-detail header that acts on it. Carried in a ref rather than state
 * so publishing it never re-renders anything — it is only ever read from an event handler.
 */
export type FileDocFlush = () => Promise<FlushFileDocResult>
const FileDocFlushContext = createContext<{ current: FileDocFlush | null }>({ current: null })

interface FileDocRoomProviderProps {
  children: ReactNode
  /**
   * Optional ref for the open document's flush, owned by an ANCESTOR of this provider.
   *
   * `useFileDocFlush` only reaches descendants, which is the wrong shape for the file-detail page:
   * it renders this provider itself, so its own handlers sit above the context. Passing the ref in
   * lets that owner read the flush the editor publishes without being a descendant. Omit it and the
   * provider keeps its own ref, so descendant-only consumers work unchanged.
   */
  flushRef?: RefObject<FileDocFlush | null>
}

/**
 * Scopes "who's in this file" presence to the open document — the `RoomProvider` +
 * `useOthers` pattern (Liveblocks / y-presence) adapted to our component tree. The editor
 * owns the Yjs awareness but sits *below* the file-detail header that renders the avatar
 * stack, so it publishes the SERVER-AUTHENTICATED roster into this context
 * ({@link useReportFileDocOthers}) and the header reads it ({@link useFileDocOthers}).
 * Presence is ephemeral and room-scoped, so it lives in this provider, not a global store.
 */
export function FileDocRoomProvider({ children, flushRef }: FileDocRoomProviderProps) {
  const [others, setOthers] = useState<PresenceAvatarUser[]>(EMPTY_OTHERS)
  // A ref, not state: the flush is read at call time by an event handler, never rendered. Storing it
  // in state would re-render the whole file detail every time a provider mounts or tears down.
  const ownFlushRef = useRef<FileDocFlush | null>(null)
  return (
    <FileDocFlushContext.Provider value={flushRef ?? ownFlushRef}>
      <FileDocSetOthersContext.Provider value={setOthers}>
        <FileDocOthersContext.Provider value={others}>{children}</FileDocOthersContext.Provider>
      </FileDocSetOthersContext.Provider>
    </FileDocFlushContext.Provider>
  )
}

/**
 * Calls the flush behind `flushRef`, for an owner that passed its own ref to
 * {@link FileDocRoomProvider}. Resolves `skipped` when nothing collaborative is mounted, so the
 * caller needs no null check.
 */
export function flushFileDocRef(
  flushRef: RefObject<FileDocFlush | null>
): Promise<FlushFileDocResult> {
  return flushRef.current?.() ?? Promise.resolve({ fileId: '', status: 'skipped' as const })
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

/**
 * Publishes the open document's flush into the room context (editor side). Pass `null` on teardown
 * so a consumer can never call into a destroyed provider.
 */
export function useReportFileDocFlush(flush: FileDocFlush | null): void {
  const flushRef = useContext(FileDocFlushContext)
  useEffect(() => {
    flushRef.current = flush
    return () => {
      // Only clear if still ours: a remount can install the next provider's flush before this
      // cleanup runs, and blindly nulling would drop the live one.
      if (flushRef.current === flush) flushRef.current = null
    }
  }, [flush, flushRef])
}
