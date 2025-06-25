'use client'

import { useMemo } from 'react'
import { useSocket } from '@/contexts/socket-context'

type PresenceUser = {
  connectionId: string | number
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
      // Use socketId directly as connectionId to ensure uniqueness
      // If no socketId, use a unique fallback based on userId + index
      connectionId: user.socketId || `fallback-${user.userId}-${index}`,
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
