'use client'

import { useMemo } from 'react'
import { useSocket } from '@/contexts/socket-context'

// Socket presence user from server
interface SocketPresenceUser {
  socketId: string
  userId: string
  userName: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

// UI presence user for components
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
    // Deduplicate by userId - only show one presence per unique user
    const uniqueUsers = new Map<string, SocketPresenceUser>()

    presenceUsers.forEach((user) => {
      // Keep the most recent presence for each user (last one wins)
      uniqueUsers.set(user.userId, user)
    })

    return Array.from(uniqueUsers.values()).map((user) => ({
      // Use userId as connectionId since we've deduplicated
      connectionId: user.userId,
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
