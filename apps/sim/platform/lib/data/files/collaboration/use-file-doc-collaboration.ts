'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FILE_DOC_EVENTS, type FileDocPresence } from '@sim/realtime-protocol/file-doc'
import { type QueryFilters, useQueryClient } from '@tanstack/react-query'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { getUserColor } from '@/lib/workspaces/colors'
import { FileDocProvider } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-doc-provider'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { workspaceFileMetadataFilter } from '@/hooks/queries/utils/workspace-file-cache'
import { workspaceFilesKeys } from '@/hooks/queries/utils/workspace-file-keys'

/** A collaborator in the open file, from the server-authenticated roster. */
interface FileDocRosterPeer {
  userId: string
  userName: string
  avatarUrl: string | null
}

/** The live binding the editor wires into TipTap's Collaboration and CollaborationCaret. */
interface FileDocCollaboration {
  doc: Y.Doc
  awareness: Awareness
  /** `null` until the socket is available; `doc` and `awareness` exist before it connects. */
  provider: FileDocProvider | null
  canWrite: boolean
  /** The local caret identity published to awareness; the avatar roster comes from the server. */
  user: { name: string; color: string; clientId: number | undefined }
}

interface UseFileDocCollaborationParams {
  workspaceId: string
  fileId: string
  userId: string
  userName: string
  /** Decided once at editor mount: only a live, readable workspace document collaborates. */
  enabled: boolean
  onWriteAccessLost?: () => void
  /** Receives the other people in the file, for the page's avatar stack. */
  reportPeers: (peers: FileDocRosterPeer[]) => void
}

/** Teardown waits a tick, so a StrictMode remount keeps the doc the editor froze at mount. */
const TEARDOWN_DELAY_MS = 0

/**
 * Owns the per-file Yjs document, awareness and {@link FileDocProvider} for collaborative editing.
 * The document and awareness are created once and stay stable for the editor's life; the provider
 * connects them to the realtime relay over the shared socket. Returns `null` while disabled.
 */
export function useFileDocCollaboration({
  workspaceId,
  fileId,
  userId,
  userName,
  enabled,
  onWriteAccessLost,
  reportPeers,
}: UseFileDocCollaborationParams): FileDocCollaboration | null {
  const { socket } = useSocket()
  const queryClient = useQueryClient()
  const onWriteAccessLostRef = useRef(onWriteAccessLost)
  onWriteAccessLostRef.current = onWriteAccessLost
  const reportPeersRef = useRef(reportPeers)
  reportPeersRef.current = reportPeers

  const docRef = useRef<Y.Doc | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  if (enabled && docRef.current === null) {
    docRef.current = new Y.Doc()
    awarenessRef.current = new Awareness(docRef.current)
  }

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
      }, TEARDOWN_DELAY_MS)
    }
  }, [])

  const [provider, setProvider] = useState<FileDocProvider | null>(null)
  const [canWrite, setCanWrite] = useState(false)

  useEffect(() => {
    const doc = docRef.current
    const awareness = awarenessRef.current
    if (!enabled || !socket || !doc || !awareness) return
    const fileProvider = new FileDocProvider(socket, fileId, doc, awareness, {
      owner: { entityType: 'workspace', entityId: workspaceId },
      userId,
    })
    setCanWrite(fileProvider.canWrite)
    const reloadAfterWriteLoss = async () => {
      onWriteAccessLostRef.current?.()
      const filters: QueryFilters[] = [
        { queryKey: workspaceFilesKeys.contentFile(workspaceId, fileId) },
        workspaceFileMetadataFilter(workspaceId),
      ]
      await Promise.all(filters.map((filter) => queryClient.cancelQueries(filter)))
      await Promise.all(filters.map((filter) => queryClient.resetQueries(filter)))
    }
    fileProvider.on('permission', setCanWrite)
    fileProvider.on('write-access-lost', reloadAfterWriteLoss)
    setProvider(fileProvider)
    return () => {
      fileProvider.off('permission', setCanWrite)
      fileProvider.off('write-access-lost', reloadAfterWriteLoss)
      fileProvider.destroy()
      setProvider(null)
    }
  }, [enabled, socket, fileId, workspaceId, userId, queryClient])

  useEffect(() => {
    if (!enabled || !socket) return
    const handlePresence = (data: FileDocPresence) => {
      if (data.fileId !== fileId) return
      const byUser = new Map<string, FileDocRosterPeer>()
      for (const peer of data.users) {
        if (peer.socketId === socket.id || byUser.has(peer.userId)) continue
        byUser.set(peer.userId, {
          userId: peer.userId,
          userName: peer.userName,
          avatarUrl: peer.avatarUrl,
        })
      }
      reportPeersRef.current([...byUser.values()])
    }
    const handleDisconnect = () => reportPeersRef.current([])
    socket.on(FILE_DOC_EVENTS.PRESENCE, handlePresence)
    socket.on('disconnect', handleDisconnect)
    return () => {
      socket.off(FILE_DOC_EVENTS.PRESENCE, handlePresence)
      socket.off('disconnect', handleDisconnect)
      reportPeersRef.current([])
    }
  }, [enabled, socket, fileId])

  const user = useMemo(
    () => ({ name: userName, color: getUserColor(userId), clientId: docRef.current?.clientID }),
    [userName, userId]
  )

  return useMemo(() => {
    const doc = docRef.current
    const awareness = awarenessRef.current
    return enabled && doc && awareness ? { doc, awareness, provider, canWrite, user } : null
  }, [enabled, provider, canWrite, user])
}
