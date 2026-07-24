'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import type { PresenceAvatarUser } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { invalidateWorkspaceFileBrowsers } from '@/hooks/queries/workspace-file-folders'

const logger = createLogger('WorkspaceFilesRoom')

/** Retry cap + base delay for a retryable join failure on an otherwise-live socket. */
const MAX_JOIN_RETRIES = 3
const JOIN_RETRY_BASE_MS = 1000
/** Minimum gap between outbound cursor frames (~30fps), matching the canvas. */
const CURSOR_THROTTLE_MS = 33

interface PresenceUpdatePayload extends PresenceAvatarUser {
  folderId?: string | null
}

interface JoinErrorPayload {
  workspaceId: string
  error: string
  code: string
  retryable?: boolean
}

/** A collaborator's cursor in content-space coordinates of the file list. */
export interface FilesCursor {
  socketId: string
  userId: string
  userName: string
  cursor: { x: number; y: number }
}

interface FilesCursorPayload {
  socketId: string
  userId: string
  userName: string
  cursor: { x: number; y: number } | null
  folderId: string | null
}

interface UseWorkspaceFilesRoomResult {
  /** Collaborators viewing this workspace's files, excluding the current socket. */
  otherUsers: PresenceAvatarUser[]
  /** Remote cursors in the currently-open folder, excluding the current socket. */
  cursors: FilesCursor[]
  /** Emit the local content-space pointer position (throttled). Pass `null` when it leaves the list. */
  emitCursor: (cursor: { x: number; y: number } | null) => void
}

/**
 * Joins the workspace-files presence room for live collaborator avatars and a live
 * file tree. Presence rides the shared socket (`useSocket`); file mutations are
 * unchanged (HTTP), and a `workspace-files-changed` broadcast invalidates the
 * browser queries so every viewer refetches without waiting for staleness.
 *
 * `folderId` is sent on join so the server records where the viewer is; it is
 * intentionally not a hook dependency (re-joining on every folder change would
 * churn presence) — the ref keeps the latest value for the next join.
 */
export function useWorkspaceFilesRoom(
  workspaceId: string,
  folderId: string | null
): UseWorkspaceFilesRoomResult {
  const { socket, currentSocketId } = useSocket()
  const queryClient = useQueryClient()

  const [presenceUsers, setPresenceUsers] = useState<PresenceUpdatePayload[]>([])
  const [cursorBySocket, setCursorBySocket] = useState<
    Map<string, FilesCursor & { folderId: string | null }>
  >(() => new Map())

  const tabSessionIdRef = useRef<string>('')
  if (!tabSessionIdRef.current) tabSessionIdRef.current = generateShortId()
  const folderIdRef = useRef(folderId)
  const lastCursorEmitRef = useRef(0)

  useEffect(() => {
    folderIdRef.current = folderId
  }, [folderId])

  useEffect(() => {
    if (!socket || !workspaceId) return

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const join = () => {
      socket.emit('join-workspace-files', {
        workspaceId,
        folderId: folderIdRef.current,
        tabSessionId: tabSessionIdRef.current,
      })
    }

    const handleJoinSuccess = (data: {
      workspaceId: string
      presenceUsers: PresenceUpdatePayload[]
    }) => {
      if (data.workspaceId !== workspaceId) return
      retries = 0
      // Cancel any retry scheduled by a prior retryable error so it can't fire an
      // extra join after we're already in.
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      setPresenceUsers(data.presenceUsers ?? [])
    }
    const handleJoinError = (data: JoinErrorPayload) => {
      if (data.workspaceId !== workspaceId) return
      logger.warn('Failed to join workspace files room', { code: data.code, error: data.error })
      if (data.retryable && retries < MAX_JOIN_RETRIES) {
        retries += 1
        retryTimer = setTimeout(join, JOIN_RETRY_BASE_MS * retries)
      }
    }
    const handlePresence = (users: PresenceUpdatePayload[]) => setPresenceUsers(users ?? [])
    const handleChanged = (data: { workspaceId: string }) => {
      if (data.workspaceId === workspaceId)
        invalidateWorkspaceFileBrowsers(queryClient, workspaceId)
    }
    const handleCursor = (data: FilesCursorPayload) => {
      setCursorBySocket((prev) => {
        const next = new Map(prev)
        if (data.cursor) {
          next.set(data.socketId, {
            socketId: data.socketId,
            userId: data.userId,
            userName: data.userName,
            cursor: data.cursor,
            folderId: data.folderId ?? null,
          })
        } else {
          next.delete(data.socketId)
        }
        return next
      })
    }

    // Join now if the socket is already connected; `connect` covers (re)connects.
    if (socket.connected) join()
    socket.on('connect', join)
    socket.on('join-workspace-files-success', handleJoinSuccess)
    socket.on('join-workspace-files-error', handleJoinError)
    socket.on('workspace-files:presence-update', handlePresence)
    socket.on('workspace-files-changed', handleChanged)
    socket.on('files-cursor-update', handleCursor)

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      socket.off('connect', join)
      socket.off('join-workspace-files-success', handleJoinSuccess)
      socket.off('join-workspace-files-error', handleJoinError)
      socket.off('workspace-files:presence-update', handlePresence)
      socket.off('workspace-files-changed', handleChanged)
      socket.off('files-cursor-update', handleCursor)
      setPresenceUsers([])
      setCursorBySocket(new Map())

      // Leave the room, scoped to THIS workspace: the server no-ops if the socket
      // has already switched to another workspace's files room (so a workspace
      // A→B switch, where B's join runs first and auto-leaves A, can't have A's
      // leave evict the fresh B membership).
      socket.emit('leave-workspace-files', { workspaceId })
    }
  }, [socket, workspaceId, queryClient])

  const emitCursor = useCallback(
    (cursor: { x: number; y: number } | null) => {
      if (!socket) return
      if (cursor) {
        const now = Date.now()
        if (now - lastCursorEmitRef.current < CURSOR_THROTTLE_MS) return
        lastCursorEmitRef.current = now
      }
      socket.emit('files-cursor-update', { cursor, folderId: folderIdRef.current })
    },
    [socket]
  )

  const otherUsers = useMemo(
    () => presenceUsers.filter((user) => user.socketId !== currentSocketId),
    [presenceUsers, currentSocketId]
  )

  const cursors = useMemo(
    () =>
      Array.from(cursorBySocket.values()).filter(
        (c) => c.socketId !== currentSocketId && (c.folderId ?? null) === (folderId ?? null)
      ),
    [cursorBySocket, currentSocketId, folderId]
  )

  return { otherUsers, cursors, emitCursor }
}
