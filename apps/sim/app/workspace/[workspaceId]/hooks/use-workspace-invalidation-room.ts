'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { RoomType } from '@sim/realtime-protocol/rooms'
import type { Socket } from 'socket.io-client'
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

interface SharedRoomSubscription {
  callbacks: Map<string | symbol, Set<() => void>>
  dispose: () => void
}

const subscriptionsBySocket = new WeakMap<Socket, Map<string, SharedRoomSubscription>>()

function createSharedRoomSubscription(
  socket: Socket,
  workspaceId: string,
  roomType: RoomType
): SharedRoomSubscription {
  const joinEvent = `join-${roomType}`
  const successEvent = `${joinEvent}-success`
  const errorEvent = `${joinEvent}-error`
  const leaveEvent = `leave-${roomType}`
  const changedEvent = `${roomType}-changed`
  const callbacks = new Map<string | symbol, Set<() => void>>()
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const join = () => socket.emit(joinEvent, { workspaceId })
  const handleConnect = () => {
    retries = 0
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    join()
  }
  const handleJoinSuccess = (data: { workspaceId: string }) => {
    if (data.workspaceId !== workspaceId) return
    retries = 0
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }
  const handleJoinError = (data: JoinErrorPayload) => {
    if (data.workspaceId !== workspaceId) return
    logger.warn(`Failed to join ${roomType} room`, { code: data.code, error: data.error })
    if (!data.retryable || retries >= MAX_JOIN_RETRIES) return
    retries += 1
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(join, JOIN_RETRY_BASE_MS * retries)
  }
  const handleChanged = (data: { workspaceId: string }) => {
    if (data.workspaceId !== workspaceId) return
    for (const group of callbacks.values()) group.values().next().value?.()
  }

  if (socket.connected) join()
  socket.on('connect', handleConnect)
  socket.on(successEvent, handleJoinSuccess)
  socket.on(errorEvent, handleJoinError)
  socket.on(changedEvent, handleChanged)

  return {
    callbacks,
    dispose: () => {
      if (retryTimer) clearTimeout(retryTimer)
      socket.off('connect', handleConnect)
      socket.off(successEvent, handleJoinSuccess)
      socket.off(errorEvent, handleJoinError)
      socket.off(changedEvent, handleChanged)
      socket.emit(leaveEvent, { workspaceId })
    },
  }
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
  onChanged: () => void,
  dedupeKey?: string
): void {
  const { socket } = useSocket()
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const privateCallbackKeyRef = useRef(Symbol('workspace-invalidation-callback'))

  useEffect(() => {
    if (!socket || !workspaceId) return
    const subscriberKey = `${workspaceId}|${roomType}`
    let socketSubscriptions = subscriptionsBySocket.get(socket)
    if (!socketSubscriptions) {
      socketSubscriptions = new Map()
      subscriptionsBySocket.set(socket, socketSubscriptions)
    }
    let subscription = socketSubscriptions.get(subscriberKey)
    if (!subscription) {
      subscription = createSharedRoomSubscription(socket, workspaceId, roomType)
      socketSubscriptions.set(subscriberKey, subscription)
    }

    const callbackKey = dedupeKey ?? privateCallbackKeyRef.current
    const callback = () => onChangedRef.current()
    const callbackGroup = subscription.callbacks.get(callbackKey) ?? new Set()
    callbackGroup.add(callback)
    subscription.callbacks.set(callbackKey, callbackGroup)

    return () => {
      callbackGroup.delete(callback)
      if (callbackGroup.size === 0) subscription.callbacks.delete(callbackKey)
      if (subscription.callbacks.size > 0) return
      subscription.dispose()
      socketSubscriptions.delete(subscriberKey)
      if (socketSubscriptions.size === 0) subscriptionsBySocket.delete(socket)
    }
  }, [dedupeKey, socket, workspaceId, roomType])
}
