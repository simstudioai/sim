'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FILE_DOC_EVENTS, type FileDocPresence } from '@sim/realtime-protocol/file-doc'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { getUserColor } from '@/lib/workspaces/colors'
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
   * The local caret identity published to awareness: `name`/`color` for CollaborationCaret,
   * and `clientId` so the caret activity extension can tag each caret node (see
   * caret-presence.ts). The avatar roster does NOT come from here — it's server-authenticated
   * (see the PRESENCE subscription below) so a peer can't spoof identity via awareness.
   */
  user: { name: string; color: string; clientId: number | undefined }
}

interface UseFileDocCollaborationParams {
  fileId: string
  userId: string
  userName: string
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
  enabled,
}: UseFileDocCollaborationParams): FileDocCollaboration | null {
  const { socket } = useSocket()

  // The Y.Doc + Awareness are the editor's authoritative binding — created once
  // and stable for the hook's life (see sim-react-performance: lazy-init ref).
  // Only allocated when collaboration is enabled, so read-only / streaming /
  // round-trip-unsafe views never build a Yjs document they won't use.
  const docRef = useRef<Y.Doc | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  // Created ONCE and kept stable for the whole editor lifetime. The editor freezes these into
  // its extension set at mount (`useEditor` fixes extensions at creation), so the instances the
  // provider binds MUST stay byte-identical to what the editor holds — never destroyed-and-
  // recreated mid-life. If a StrictMode dev remount destroyed them, the still-mounted editor
  // would keep the dead doc while the provider synced a fresh one, and a joining peer would see a
  // blank document. Teardown is therefore deferred to a REAL unmount only (see below).
  if (enabled && docRef.current === null) {
    docRef.current = new Y.Doc()
    awarenessRef.current = new Awareness(docRef.current)
  }

  // Destroy the doc + awareness on a REAL unmount only. `Awareness` runs a setInterval to expire
  // stale peers, so it MUST be destroyed or that timer leaks for every file ever opened. But a
  // StrictMode dev remount fires this cleanup and then re-runs the setup synchronously after — so
  // we SCHEDULE the teardown and the remount cancels it, keeping the frozen instances alive. A
  // genuine unmount has no remount, so the scheduled teardown runs on the next tick.
  const pendingTeardownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pendingTeardownRef.current !== null) {
      clearTimeout(pendingTeardownRef.current)
      pendingTeardownRef.current = null
    }
    return () => {
      pendingTeardownRef.current = setTimeout(() => {
        awarenessRef.current?.destroy()
        docRef.current?.destroy()
      }, 0)
    }
  }, [])

  const [provider, setProvider] = useState<FileDocProvider | null>(null)

  useEffect(() => {
    if (!enabled || !socket) return
    // Non-null: both refs are set during render before any effect runs, and are never destroyed
    // (see above), so this always binds the same doc/awareness the editor froze at mount.
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

  // "Who's in this file" roster (the useOthers side of the pattern). The server broadcasts a
  // roster of SERVER-AUTHENTICATED identities (see FILE_DOC_EVENTS.PRESENCE) — trusted,
  // unlike the client-set awareness `user` field a peer could spoof. Publish it (minus self)
  // to the room context for the file-detail avatar stack; cleared on unmount so a file switch
  // never shows the previous file's occupants.
  useEffect(() => {
    if (!enabled || !socket) return
    const handlePresence = (data: FileDocPresence) => {
      if (data.fileId !== fileId) return
      // Exclude only our OWN socket (this session), NOT every session that shares our userId —
      // so a second tab of the same account still counts as present, matching the canvas avatars
      // (avatars.tsx filters by socketId). Then dedupe per user for the display stack, so
      // multiple tabs of one person collapse to a single avatar.
      const byUser = new Map<
        string,
        { userId: string; userName: string; avatarUrl: string | null }
      >()
      for (const peer of data.users) {
        if (peer.socketId === socket.id || byUser.has(peer.userId)) continue
        byUser.set(peer.userId, {
          userId: peer.userId,
          userName: peer.userName,
          avatarUrl: peer.avatarUrl,
        })
      }
      reportOthersRef.current([...byUser.values()])
    }
    socket.on(FILE_DOC_EVENTS.PRESENCE, handlePresence)
    return () => {
      socket.off(FILE_DOC_EVENTS.PRESENCE, handlePresence)
      reportOthersRef.current([])
    }
  }, [enabled, socket, fileId])

  // The client id rides in the awareness `user` payload so the caret `render` (which only
  // receives `user`) can tag each caret node for the activity-driven name label (see
  // caret-presence.ts). `doc.clientID` is stable for the doc's life, so reading it from the
  // ref needs no memo dep.
  const user = useMemo(
    () => ({ name: userName, color: getUserColor(userId), clientId: docRef.current?.clientID }),
    [userName, userId]
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
