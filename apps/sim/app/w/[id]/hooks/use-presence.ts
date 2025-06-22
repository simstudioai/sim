'use client'

import { useMemo } from 'react'
import { useSocket } from '@/contexts/socket-context'

interface PresenceUser {
  connectionId: number
  name?: string
  color?: string
  info?: string
}

interface UsePresenceReturn {
  users: PresenceUser[]
  currentUser: PresenceUser | null
  isConnected: boolean
}

/**
 * Hook for managing user presence in collaborative workflows using Socket.IO
 * Uses the existing Socket context to get real presence data
 */
export function usePresence(): UsePresenceReturn {
  const { presenceUsers, isConnected } = useSocket()

  const users = useMemo(() => {
    return presenceUsers.map((user, index) => ({
      connectionId: user.socketId
        ? Math.abs(user.socketId.split('').reduce((a, b) => a + b.charCodeAt(0), 0))
        : index + 1,
      name: user.userName,
      color: undefined, // Let the avatar component generate colors
      info: user.selection?.type ? `Editing ${user.selection.type}` : undefined,
    }))
  }, [presenceUsers])

  return {
    users,
    currentUser: null,
    isConnected,
  }
}
