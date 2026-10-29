'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { RoomType } from '@sim/realtime-protocol/rooms'
import { sleep } from '@sim/utils/helpers'
import type { Socket } from 'socket.io-client'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { useSocket } from '@/app/workspace/providers/socket-provider'

const logger = createLogger('WorkspaceInvalidationRoom')

/** Retry cap + base delay for a retryable join failure on an otherwise-live socket. */
const MAX_JOIN_RETRIES = 3
const JOIN_RETRY_BASE_MS = 1000
/**
 * The least time between two deliveries of a room's changes. A burst of broadcasts (an API client
 * uploading files one by one) otherwise refetches every viewer's list once per broadcast.
 */
export const INVALIDATION_COALESCE_MS = 1000
/**
 * The longest a delivery waits for its refetches. A fetch has no timeout of its own, so one that
 * hangs would otherwise hold the room's deliveries forever. Past this, later deliveries run again:
 * their invalidation cancels and restarts a hung refetch of a query that has data, while a hung
 * first load is joined, as it always was, until it settles or its last observer unmounts.
 */
export const DELIVERY_SETTLE_CAP_MS = 30_000

interface JoinErrorPayload {
  workspaceId: string
  error: string
  code: string
  retryable?: boolean
}

/**
 * Runs when the room's resources changed. A returned promise is awaited, up to
 * {@link DELIVERY_SETTLE_CAP_MS}, before the next delivery starts.
 */
type RoomChangedCallback = () => unknown

interface SharedRoomSubscription {
  callbacks: Map<string | symbol, Set<RoomChangedCallback>>
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
  const callbacks = new Map<string | symbol, Set<RoomChangedCallback>>()
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let delivering = false
  let changedSinceDelivery = false
  let disposed = false

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
  /**
   * The first change is delivered at once. Changes arriving while a delivery runs, or within
   * {@link INVALIDATION_COALESCE_MS} after it settles, are folded into one delivery after that.
   */
  const deliver = async () => {
    delivering = true
    try {
      do {
        changedSinceDelivery = false
        const settled = Promise.allSettled(
          [...callbacks.values()].map(async (group) => group.values().next().value?.())
        )
        // `allSettled` never rejects, so the only rejection here is the cap expiring.
        await withinDeadline(() => settled, Date.now() + DELIVERY_SETTLE_CAP_MS).catch(() => {})
        await sleep(INVALIDATION_COALESCE_MS)
      } while (changedSinceDelivery && !disposed)
    } finally {
      delivering = false
    }
  }
  const handleChanged = (data: { workspaceId: string }) => {
    if (data.workspaceId !== workspaceId) return
    if (delivering) {
      changedSinceDelivery = true
      return
    }
    void deliver()
  }

  if (socket.connected) join()
  socket.on('connect', handleConnect)
  socket.on(successEvent, handleJoinSuccess)
  socket.on(errorEvent, handleJoinError)
  socket.on(changedEvent, handleChanged)

  return {
    callbacks,
    dispose: () => {
      disposed = true
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
 * refetches without waiting for staleness. A burst of broadcasts is coalesced: one delivery at a
 * time, at most one per {@link INVALIDATION_COALESCE_MS} after the previous one settles. Shared core
 * behind {@link useWorkspaceFilesRoom} and {@link useWorkspaceTablesRoom}; event names derive from
 * `roomType`.
 *
 * These rooms carry no presence — "who's in a resource" comes from the per-resource room, not from
 * who's browsing the section. Mutations happen server-side (HTTP + copilot) and fan out this signal.
 */
export function useWorkspaceInvalidationRoom(
  workspaceId: string,
  roomType: RoomType,
  onChanged: RoomChangedCallback,
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
