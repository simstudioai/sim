'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { invalidateWorkspaceFileBrowsers } from '@/hooks/queries/workspace-file-folders'

const logger = createLogger('WorkspaceFilesRoom')

/** Retry cap + base delay for a retryable join failure on an otherwise-live socket. */
const MAX_JOIN_RETRIES = 3
const JOIN_RETRY_BASE_MS = 1000

interface JoinErrorPayload {
  workspaceId: string
  error: string
  code: string
  retryable?: boolean
}

/**
 * Keeps the file browser live: joins the workspace-files room over the shared socket so a
 * `workspace-files-changed` broadcast (fanned out by the HTTP mutation API) invalidates the
 * browser queries and every viewer refetches without waiting for staleness. File mutations
 * stay on HTTP.
 *
 * This room carries no presence — "who's in a file" comes from the per-file doc room (see
 * `FileDocRoomProvider`), not from who's browsing the Files section.
 */
export function useWorkspaceFilesRoom(workspaceId: string): void {
  const { socket } = useSocket()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!socket || !workspaceId) return

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const join = () => socket.emit('join-workspace-files', { workspaceId })

    const handleJoinSuccess = (data: { workspaceId: string }) => {
      if (data.workspaceId !== workspaceId) return
      retries = 0
      // Cancel any retry scheduled by a prior retryable error so it can't fire an extra
      // join after we're already in.
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }
    const handleJoinError = (data: JoinErrorPayload) => {
      if (data.workspaceId !== workspaceId) return
      logger.warn('Failed to join workspace files room', { code: data.code, error: data.error })
      if (data.retryable && retries < MAX_JOIN_RETRIES) {
        retries += 1
        retryTimer = setTimeout(join, JOIN_RETRY_BASE_MS * retries)
      }
    }
    const handleChanged = (data: { workspaceId: string }) => {
      if (data.workspaceId === workspaceId)
        invalidateWorkspaceFileBrowsers(queryClient, workspaceId)
    }

    // Join now if the socket is already connected; `connect` covers (re)connects.
    if (socket.connected) join()
    socket.on('connect', join)
    socket.on('join-workspace-files-success', handleJoinSuccess)
    socket.on('join-workspace-files-error', handleJoinError)
    socket.on('workspace-files-changed', handleChanged)

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      socket.off('connect', join)
      socket.off('join-workspace-files-success', handleJoinSuccess)
      socket.off('join-workspace-files-error', handleJoinError)
      socket.off('workspace-files-changed', handleChanged)

      // Leave the room, scoped to THIS workspace: the server no-ops if the socket has
      // already switched to another workspace's files room (so a workspace A→B switch,
      // where B's join runs first and auto-leaves A, can't have A's leave evict B).
      socket.emit('leave-workspace-files', { workspaceId })
    }
  }, [socket, workspaceId, queryClient])
}
