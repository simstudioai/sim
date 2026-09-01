'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { RoomType } from '@sim/realtime-protocol/rooms'
import { useSocket } from '@/app/workspace/providers/socket-provider'

const logger = createLogger('WorkspaceInvalidationRoom')

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
 * Joins a workspace-scoped, presence-free "invalidation room" over the shared socket and runs
 * `onChanged` whenever the server broadcasts `${roomType}-changed` for this workspace, so the list
 * refetches without waiting for staleness. Shared core behind {@link useWorkspaceFilesRoom} and
 * {@link useWorkspaceTablesRoom}; event names derive from `roomType`.
 *
 * These rooms carry no presence — "who's in a resource" comes from the per-resource room, not from
 * who's browsing the section. Mutations happen server-side (HTTP + copilot) and fan out this signal.
 */
export function useWorkspaceInvalidationRoom(
  workspaceId: string,
  roomType: RoomType,
  onChanged: () => void
): void {
  const { socket } = useSocket()
  // Held by ref so a caller passing a fresh closure each render never re-subscribes the socket.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  useEffect(() => {
    if (!socket || !workspaceId) return

    const joinEvent = `join-${roomType}`
    const successEvent = `${joinEvent}-success`
    const errorEvent = `${joinEvent}-error`
    const leaveEvent = `leave-${roomType}`
    const changedEvent = `${roomType}-changed`

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const join = () => socket.emit(joinEvent, { workspaceId })

    // A fresh (re)connect gets a fresh retry budget, so a prior full exhaustion doesn't leave the
    // socket unable to retry a failed re-join until the next success. Cancel any retry still pending
    // from before the reconnect so it can't fire a duplicate join after this immediate one.
    const handleConnect = () => {
      retries = 0
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      join()
    }

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
      logger.warn(`Failed to join ${roomType} room`, { code: data.code, error: data.error })
      if (data.retryable && retries < MAX_JOIN_RETRIES) {
        retries += 1
        // Clear any still-pending retry before scheduling a new one, so reconnect churn can't
        // orphan a timer that fires an extra join().
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(join, JOIN_RETRY_BASE_MS * retries)
      }
    }
    const handleChanged = (data: { workspaceId: string }) => {
      if (data.workspaceId === workspaceId) onChangedRef.current()
    }

    // Join now if the socket is already connected; `connect` covers (re)connects.
    if (socket.connected) join()
    socket.on('connect', handleConnect)
    socket.on(successEvent, handleJoinSuccess)
    socket.on(errorEvent, handleJoinError)
    socket.on(changedEvent, handleChanged)

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      socket.off('connect', handleConnect)
      socket.off(successEvent, handleJoinSuccess)
      socket.off(errorEvent, handleJoinError)
      socket.off(changedEvent, handleChanged)

      // Leave the room, scoped to THIS workspace: the server no-ops if the socket has already
      // switched to another workspace's room (so a workspace A→B switch, where B's join runs first
      // and auto-leaves A, can't have A's leave evict B).
      socket.emit(leaveEvent, { workspaceId })
    }
  }, [socket, workspaceId, roomType])
}
