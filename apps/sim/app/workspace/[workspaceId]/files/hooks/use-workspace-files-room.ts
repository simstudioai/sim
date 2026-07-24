'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

interface PresenceUpdatePayload extends PresenceAvatarUser {
  folderId?: string | null
}

interface JoinErrorPayload {
  workspaceId: string
  error: string
  code: string
  retryable?: boolean
}

interface UseWorkspaceFilesRoomResult {
  /** Collaborators viewing this workspace's files, excluding the current socket. */
  otherUsers: PresenceAvatarUser[]
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

  const tabSessionIdRef = useRef<string>('')
  if (!tabSessionIdRef.current) tabSessionIdRef.current = generateShortId()
  const folderIdRef = useRef(folderId)

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

    // Join now if the socket is already connected; `connect` covers (re)connects.
    if (socket.connected) join()
    socket.on('connect', join)
    socket.on('join-workspace-files-success', handleJoinSuccess)
    socket.on('join-workspace-files-error', handleJoinError)
    socket.on('workspace-files:presence-update', handlePresence)
    socket.on('workspace-files-changed', handleChanged)

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      socket.emit('leave-workspace-files')
      socket.off('connect', join)
      socket.off('join-workspace-files-success', handleJoinSuccess)
      socket.off('join-workspace-files-error', handleJoinError)
      socket.off('workspace-files:presence-update', handlePresence)
      socket.off('workspace-files-changed', handleChanged)
      setPresenceUsers([])
    }
  }, [socket, workspaceId, queryClient])

  const otherUsers = useMemo(
    () => presenceUsers.filter((user) => user.socketId !== currentSocketId),
    [presenceUsers, currentSocketId]
  )

  return { otherUsers }
}
