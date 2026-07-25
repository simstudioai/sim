'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { getUserColor } from '@/lib/workspaces/colors'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { FileDocProvider } from './file-doc-provider'

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
  /** Local caret identity for CollaborationCaret: display name + assigned color. */
  user: { name: string; color: string }
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

  const user = useMemo(() => ({ name: userName, color: getUserColor(userId) }), [userName, userId])

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
