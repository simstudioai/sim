'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { getUserColor } from '@/lib/workspaces/colors'
import type { PresenceAvatarUser } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { FileDocProvider } from './file-doc-provider'
import { useReportFileDocOthers } from './file-doc-room-context'

/** The live collaboration binding the editor wires into TipTap's Collaboration
 * (the {@link Y.Doc}) and CollaborationCaret (the awareness). */
export interface FileDocCollaboration {
  /** Bound to TipTap's Collaboration extension (created synchronously at mount). */
  doc: Y.Doc
  /** Bound to CollaborationCaret (via `{ awareness }`); relayed by the provider. */
  awareness: Awareness
  /**
   * The realtime provider, or `null` until the socket is available. `doc` and
   * `awareness` exist before it connects, so the editor can bind immediately; the
   * provider is consumed for seeding events (`synced` / `seed-request`).
   */
  provider: FileDocProvider | null
  /**
   * The local presence identity published to awareness: what CollaborationCaret renders
   * (name/color) plus the fields peers read back — `clientId` for the caret activity
   * extension, `userId`/`avatarUrl` for the "who's in this file" avatar roster.
   */
  user: {
    name: string
    color: string
    clientId: number | undefined
    userId: string
    avatarUrl: string | null | undefined
  }
}

interface UseFileDocCollaborationParams {
  fileId: string
  userId: string
  userName: string
  /** The local user's avatar URL, published to awareness for the presence roster. */
  avatarUrl?: string | null
  /**
   * Whether to establish collaboration. Decided once at editor mount — only for a
   * live, editable, non-streaming workspace document. When `false` the hook
   * returns `null` and the editor stays fully local.
   */
  enabled: boolean
}

/**
 * Owns the per-file Yjs document, awareness, and {@link FileDocProvider} for
 * collaborative editing. The document + awareness are created once (this hook
 * lives inside an editor that is keyed by file id, so one instance == one file)
 * and are the stable objects TipTap binds to; the provider connects them to the
 * realtime relay over the shared socket. Returns `null` while disabled.
 */
export function useFileDocCollaboration({
  fileId,
  userId,
  userName,
  avatarUrl,
  enabled,
}: UseFileDocCollaborationParams): FileDocCollaboration | null {
  const { socket } = useSocket()

  // The Y.Doc + Awareness are the editor's authoritative binding — created once
  // and stable for the hook's life (see sim-react-performance: lazy-init ref).
  // Only allocated when collaboration is enabled, so read-only / streaming /
  // round-trip-unsafe views never build a Yjs document they won't use.
  const docRef = useRef<Y.Doc | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  if (enabled && docRef.current === null) {
    docRef.current = new Y.Doc()
    awarenessRef.current = new Awareness(docRef.current)
  }

  const [provider, setProvider] = useState<FileDocProvider | null>(null)

  // Declared BEFORE the provider effect so, on unmount, React runs this cleanup
  // AFTER the provider effect's cleanup (cleanups run in reverse declaration
  // order) — the provider detaches from the doc/awareness before they're destroyed.
  useEffect(() => {
    return () => {
      awarenessRef.current?.destroy()
      docRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    if (!enabled || !socket) return
    // Non-null: both refs are lazily set during render, before any effect runs.
    const doc = docRef.current as Y.Doc
    const awareness = awarenessRef.current as Awareness
    const fileProvider = new FileDocProvider(socket, fileId, doc, awareness)
    setProvider(fileProvider)
    return () => {
      fileProvider.destroy()
      setProvider(null)
    }
  }, [enabled, socket, fileId])

  const reportOthers = useReportFileDocOthers()
  const reportOthersRef = useRef(reportOthers)
  reportOthersRef.current = reportOthers

  // The "who's in this file" roster (the useOthers side of the pattern): on every awareness
  // change, read each remote state's `user`, dedupe by user id (multiple tabs = one person),
  // and publish to the room context so the file-detail header can render an avatar stack.
  // Cleared on unmount so a file switch never shows the previous file's occupants.
  useEffect(() => {
    if (!enabled) return
    const awareness = awarenessRef.current as Awareness
    const localId = awareness.clientID
    const publish = () => {
      const byUser = new Map<string, PresenceAvatarUser>()
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === localId) return
        const u = state.user as
          | { userId?: unknown; name?: unknown; avatarUrl?: unknown }
          | undefined
        if (!u || typeof u.userId !== 'string' || byUser.has(u.userId)) return
        byUser.set(u.userId, {
          userId: u.userId,
          userName: typeof u.name === 'string' ? u.name : undefined,
          avatarUrl: typeof u.avatarUrl === 'string' ? u.avatarUrl : null,
        })
      })
      reportOthersRef.current(Array.from(byUser.values()))
    }
    awareness.on('change', publish)
    publish()
    return () => {
      awareness.off('change', publish)
      reportOthersRef.current([])
    }
  }, [enabled])

  // The client id rides in the awareness `user` payload so the caret `render` (which only
  // receives `user`) can tag each caret node for the activity-driven name label (see
  // caret-presence.ts); `userId`/`avatarUrl` feed the presence roster above. `doc.clientID`
  // is stable for the doc's life, so reading it from the ref needs no memo dep.
  const user = useMemo(
    () => ({
      name: userName,
      color: getUserColor(userId),
      clientId: docRef.current?.clientID,
      userId,
      avatarUrl,
    }),
    [userName, userId, avatarUrl]
  )

  return useMemo(
    () =>
      enabled
        ? {
            doc: docRef.current as Y.Doc,
            awareness: awarenessRef.current as Awareness,
            provider,
            user,
          }
        : null,
    [enabled, provider, user]
  )
}
