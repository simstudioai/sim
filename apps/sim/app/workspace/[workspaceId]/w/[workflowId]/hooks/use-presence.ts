'use client'

import { useMemo } from 'react'
import { useSession } from '@/lib/auth-client'
import { useSocket } from '@/contexts/socket-context'

interface SocketPresenceUser {
  socketId: string
  userId: string
  userName: string
  avatarUrl?: string | null
  cursor?: { x: number; y: number } | null
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

type PresenceUser = {
  connectionId: string | number
  name?: string
  color?: string
  info?: string
  avatarUrl?: string | null
}

interface UsePresenceReturn {
  users: PresenceUser[]
  currentUser: PresenceUser | null
  isConnected: boolean
}

/**
 * Hook for managing user presence in collaborative workflows using Socket.IO
 * Uses the existing Socket context to get real presence data
 * Filters out the current user so only other collaborators are shown
 */
export function usePresence(): UsePresenceReturn {
  const { presenceUsers, isConnected } = useSocket()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  const users = useMemo(() => {
    const uniqueUsers = new Map<string, SocketPresenceUser>()

    presenceUsers.forEach((user) => {
      uniqueUsers.set(user.userId, user)
    })

    return Array.from(uniqueUsers.values())
      .filter((user) => user.userId !== currentUserId)
      .map((user) => ({
        connectionId: user.userId,
        name: user.userName,
        color: undefined,
        info: user.selection?.type ? `Editing ${user.selection.type}` : undefined,
        avatarUrl: user.avatarUrl,
      }))
  }, [presenceUsers, currentUserId])

  return {
    users,
    currentUser: null,
    isConnected,
  }
}
