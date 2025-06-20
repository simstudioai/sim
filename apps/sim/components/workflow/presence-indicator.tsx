'use client'

import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useSocket } from '@/contexts/socket-context'

const logger = createLogger('PresenceIndicator')

interface PresenceUser {
  socketId: string
  userId: string
  userName: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

interface PresenceIndicatorProps {
  className?: string
}

export function PresenceIndicator({ className }: PresenceIndicatorProps) {
  const { presenceUsers, isConnected } = useSocket()
  const [recentActivity, setRecentActivity] = useState<Map<string, number>>(new Map())

  // Track recent activity for users
  useEffect(() => {
    const now = Date.now()
    presenceUsers.forEach((user) => {
      if (!recentActivity.has(user.userId)) {
        setRecentActivity((prev) => new Map(prev.set(user.userId, now)))
      }
    })
  }, [presenceUsers, recentActivity])

  // Clean up old activity tracking
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      const fiveMinutesAgo = now - 5 * 60 * 1000

      setRecentActivity((prev) => {
        const updated = new Map(prev)
        for (const [userId, timestamp] of updated.entries()) {
          if (timestamp < fiveMinutesAgo) {
            updated.delete(userId)
          }
        }
        return updated
      })
    }, 60000) // Check every minute

    return () => clearInterval(interval)
  }, [])

  if (!isConnected || presenceUsers.length === 0) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className='flex items-center gap-1'>
          <div className='h-2 w-2 rounded-full bg-gray-400' />
          <span className='text-gray-500 text-sm'>{isConnected ? 'Working alone' : 'Offline'}</span>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className={`flex items-center gap-2 ${className}`}>
        <div className='flex items-center gap-1'>
          <div className='h-2 w-2 animate-pulse rounded-full bg-green-500' />
          <span className='font-medium text-green-600 text-sm'>
            {presenceUsers.length} collaborator{presenceUsers.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className='-space-x-2 flex'>
          {presenceUsers.slice(0, 5).map((user) => (
            <Tooltip key={user.socketId}>
              <TooltipTrigger asChild>
                <div className='relative'>
                  <Avatar className='h-8 w-8 border-2 border-white shadow-sm'>
                    <AvatarImage
                      src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.userName}`}
                    />
                    <AvatarFallback className='text-xs'>
                      {user.userName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  {/* Activity indicator */}
                  <div className='-bottom-1 -right-1 absolute h-3 w-3 rounded-full border border-white bg-green-500' />

                  {/* Selection indicator */}
                  {user.selection?.type === 'block' && (
                    <Badge
                      variant='secondary'
                      className='-top-2 -right-2 absolute flex h-4 w-4 items-center justify-center p-0 text-xs'
                    >
                      B
                    </Badge>
                  )}
                  {user.selection?.type === 'edge' && (
                    <Badge
                      variant='outline'
                      className='-top-2 -right-2 absolute flex h-4 w-4 items-center justify-center p-0 text-xs'
                    >
                      E
                    </Badge>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className='text-center'>
                  <p className='font-medium'>{user.userName}</p>
                  {user.selection?.type && user.selection.type !== 'none' && (
                    <p className='text-gray-500 text-xs'>
                      Editing {user.selection.type}
                      {user.selection.id && ` ${user.selection.id.slice(0, 8)}...`}
                    </p>
                  )}
                  {user.cursor && (
                    <p className='text-gray-400 text-xs'>
                      Cursor at ({Math.round(user.cursor.x)}, {Math.round(user.cursor.y)})
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}

          {presenceUsers.length > 5 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className='flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-100 shadow-sm'>
                  <span className='font-medium text-gray-600 text-xs'>
                    +{presenceUsers.length - 5}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {presenceUsers.length - 5} more collaborator
                  {presenceUsers.length - 5 > 1 ? 's' : ''}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
