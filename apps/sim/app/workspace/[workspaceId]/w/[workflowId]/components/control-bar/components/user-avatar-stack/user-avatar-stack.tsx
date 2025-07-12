'use client'

import { useMemo } from 'react'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePresence } from '../../../../hooks/use-presence'
import { ConnectionStatus } from './components/connection-status/connection-status'
import { UserAvatar } from './components/user-avatar/user-avatar'

interface User {
  connectionId: string | number
  name?: string
  color?: string
  info?: string
}

interface UserAvatarStackProps {
  users?: User[]
  maxVisible?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function UserAvatarStack({
  users: propUsers,
  maxVisible = 3,
  size = 'md',
  className = '',
}: UserAvatarStackProps) {
  // Use presence data if no users are provided via props
  const { users: presenceUsers, isConnected } = usePresence()
  const users = propUsers || presenceUsers

  // Get operation error state from collaborative workflow
  const { hasOperationError } = useCollaborativeWorkflow()

  // Memoize the processed users to avoid unnecessary re-renders
  const { visibleUsers, overflowCount } = useMemo(() => {
    if (users.length === 0) {
      return { visibleUsers: [], overflowCount: 0 }
    }

    const visible = users.slice(0, maxVisible)
    const overflow = Math.max(0, users.length - maxVisible)

    return {
      visibleUsers: visible,
      overflowCount: overflow,
    }
  }, [users, maxVisible])

  // Determine spacing based on size
  const spacingClass = {
    sm: '-space-x-1',
    md: '-space-x-1.5',
    lg: '-space-x-2',
  }[size]

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Connection status - always check, shows when offline or operation errors */}
      <ConnectionStatus isConnected={isConnected} hasOperationError={hasOperationError} />

      {/* Only show avatar stack when there are multiple users (>1) */}
      {users.length > 1 && (
        <div className={`flex items-center ${spacingClass}`}>
          {/* Render visible user avatars */}
          {visibleUsers.map((user, index) => (
            <UserAvatar
              key={user.connectionId}
              connectionId={user.connectionId}
              name={user.name}
              color={user.color}
              size={size}
              index={index}
              tooltipContent={
                user.name ? (
                  <div className='text-center'>
                    <div className='font-medium'>{user.name}</div>
                    {user.info && (
                      <div className='mt-1 text-muted-foreground text-xs'>{user.info}</div>
                    )}
                  </div>
                ) : null
              }
            />
          ))}

          {/* Render overflow indicator if there are more users */}
          {overflowCount > 0 && (
            <UserAvatar
              connectionId='overflow-indicator' // Use a unique string identifier
              name={`+${overflowCount}`}
              size={size}
              index={visibleUsers.length}
              tooltipContent={
                <div className='text-center'>
                  <div className='font-medium'>
                    {overflowCount} more user{overflowCount > 1 ? 's' : ''}
                  </div>
                  <div className='mt-1 text-muted-foreground text-xs'>
                    {users.length} total online
                  </div>
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  )
}
