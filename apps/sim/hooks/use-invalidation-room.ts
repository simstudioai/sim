'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import {
  ROOM_ACCESS_REVOKED_EVENT,
  type RoomAccessRevokedBroadcast,
} from '@sim/realtime-protocol/events'
import { invalidationRoomIdKey, type RoomType } from '@sim/realtime-protocol/rooms'
import { toRecord } from '@sim/utils/object'
import type { Socket } from 'socket.io-client'
import { useSocket } from '@/app/workspace/providers/socket-provider'

const logger = createLogger('InvalidationRoom')
const MAX_JOIN_RETRIES = 3
const JOIN_RETRY_BASE_MS = 1000

interface RoomCallbacks {
  changed: () => void
  denied?: () => void
  refreshOnJoin?: boolean
}

interface SharedRoomSubscription {
  callbacks: Map<string | symbol, Set<RoomCallbacks>>
  isDenied: () => boolean
  dispose: () => void
}

interface InvalidationRoomOptions {
  dedupeKey?: string
  onAccessDenied?: () => void
  refreshOnJoin?: boolean
}

const subscriptionsBySocket = new WeakMap<Socket, Map<string, SharedRoomSubscription>>()

function createSharedRoomSubscription(
  socket: Socket,
  ownerId: string,
  roomType: RoomType
): SharedRoomSubscription {
  const idKey = invalidationRoomIdKey(roomType)
  const target = { [idKey]: ownerId }
  const joinEvent = `join-${roomType}`
  const successEvent = `${joinEvent}-success`
  const errorEvent = `${joinEvent}-error`
  const leaveEvent = `leave-${roomType}`
  const changedEvent = `${roomType}-changed`
  const callbacks = new Map<string | symbol, Set<RoomCallbacks>>()
  let retries = 0
  let denied = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const cancelRetry = () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }
  const notify = (event: 'changed' | 'joined' | 'denied') => {
    for (const group of callbacks.values()) {
      for (const callback of group) {
        if (event === 'denied') callback.denied?.()
        else if (event === 'changed' || callback.refreshOnJoin) callback.changed()
      }
    }
  }
  const deny = () => {
    cancelRetry()
    denied = true
    notify('denied')
  }
  const join = () => {
    if (!denied) socket.emit(joinEvent, target)
  }
  const handleConnect = () => {
    denied = false
    retries = 0
    cancelRetry()
    join()
  }
  const handleJoinSuccess = (payload: unknown) => {
    if (toRecord(payload)[idKey] !== ownerId || denied) return
    retries = 0
    cancelRetry()
    notify('joined')
  }
  const handleJoinError = (payload: unknown) => {
    const data = toRecord(payload)
    if (data[idKey] !== ownerId) return
    logger.warn(`Failed to join ${roomType} room`, { code: data.code, error: data.error })
    cancelRetry()
    if (
      data.code === 'ACCESS_DENIED' ||
      data.code === 'NOT_FOUND' ||
      data.code === 'AUTHENTICATION_REQUIRED'
    ) {
      deny()
      return
    }
    if (denied || !data.retryable || retries >= MAX_JOIN_RETRIES) return
    retries += 1
    retryTimer = setTimeout(join, JOIN_RETRY_BASE_MS * retries)
  }
  const handleChanged = (payload: unknown) => {
    if (toRecord(payload)[idKey] !== ownerId || denied) return
    notify('changed')
  }
  const handleRevoked = (payload: RoomAccessRevokedBroadcast) => {
    if (payload.room.type !== roomType || payload.room.id !== ownerId) return
    deny()
  }

  if (socket.connected) join()
  socket.on('connect', handleConnect)
  socket.on(successEvent, handleJoinSuccess)
  socket.on(errorEvent, handleJoinError)
  socket.on(changedEvent, handleChanged)
  socket.on(ROOM_ACCESS_REVOKED_EVENT, handleRevoked)

  return {
    callbacks,
    isDenied: () => denied,
    dispose: () => {
      cancelRetry()
      socket.off('connect', handleConnect)
      socket.off(successEvent, handleJoinSuccess)
      socket.off(errorEvent, handleJoinError)
      socket.off(changedEvent, handleChanged)
      socket.off(ROOM_ACCESS_REVOKED_EVENT, handleRevoked)
      socket.emit(leaveEvent, target)
    },
  }
}

/** Shares presence-free subscriptions while preserving each owner's wire identity and query cache. */
export function useInvalidationRoom(
  ownerId: string,
  roomType: RoomType | null,
  onChanged: () => void,
  options: InvalidationRoomOptions = {}
): void {
  const { socket } = useSocket()
  const callbacksRef = useRef({
    ownerId,
    roomType,
    onChanged,
    onAccessDenied: options.onAccessDenied,
  })
  callbacksRef.current = { ownerId, roomType, onChanged, onAccessDenied: options.onAccessDenied }
  const privateCallbackKeyRef = useRef(Symbol('invalidation-callback'))
  const { dedupeKey, refreshOnJoin } = options

  useEffect(() => {
    if (!socket || !ownerId || !roomType) return
    const subscriberKey = `${roomType}|${ownerId}`
    let socketSubscriptions = subscriptionsBySocket.get(socket)
    if (!socketSubscriptions) {
      socketSubscriptions = new Map()
      subscriptionsBySocket.set(socket, socketSubscriptions)
    }
    let subscription = socketSubscriptions.get(subscriberKey)
    if (!subscription) {
      subscription = createSharedRoomSubscription(socket, ownerId, roomType)
      socketSubscriptions.set(subscriberKey, subscription)
    }

    const callbackKey = dedupeKey ?? privateCallbackKeyRef.current
    const boundCallbacks = callbacksRef.current
    const currentCallbacks = () =>
      callbacksRef.current.ownerId === ownerId && callbacksRef.current.roomType === roomType
        ? callbacksRef.current
        : boundCallbacks
    const callback: RoomCallbacks = {
      changed: () => currentCallbacks().onChanged(),
      denied: () => currentCallbacks().onAccessDenied?.(),
      refreshOnJoin,
    }
    const callbackGroup = subscription.callbacks.get(callbackKey) ?? new Set<RoomCallbacks>()
    callbackGroup.add(callback)
    subscription.callbacks.set(callbackKey, callbackGroup)
    if (subscription.isDenied()) callback.denied?.()

    return () => {
      callbackGroup.delete(callback)
      if (callbackGroup.size === 0) subscription.callbacks.delete(callbackKey)
      if (subscription.callbacks.size > 0) return
      subscription.dispose()
      socketSubscriptions.delete(subscriberKey)
      if (socketSubscriptions.size === 0) subscriptionsBySocket.delete(socket)
    }
  }, [dedupeKey, refreshOnJoin, socket, ownerId, roomType])
}
