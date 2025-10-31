'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ConnectionStatus } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/user-avatar-stack/components/connection-status/connection-status'
import { UserAvatar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/user-avatar-stack/components/user-avatar/user-avatar'
import { usePresence } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-presence'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'

interface User {
  connectionId: string | number
  name?: string
  color?: string
  info?: string
  avatarUrl?: string | null
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

  const shouldShowAvatars = visibleUsers.length > 0

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      {shouldShowAvatars && (
        <div className={cn('flex items-center px-2 py-1', spacingClass)}>
          {visibleUsers.map((user, index) => (
            <UserAvatar
              key={user.connectionId}
              connectionId={user.connectionId}
              name={user.name}
              color={user.color}
              avatarUrl={user.avatarUrl}
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

          {overflowCount > 0 && (
            <UserAvatar
              connectionId='overflow-indicator'
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

      <ConnectionStatus isConnected={isConnected} hasOperationError={hasOperationError} />
    </div>
  )
}
