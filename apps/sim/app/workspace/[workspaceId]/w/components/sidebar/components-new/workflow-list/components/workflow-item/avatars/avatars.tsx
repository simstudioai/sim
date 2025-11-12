'use client'

import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { Tooltip } from '@/components/emcn'
import { useSession } from '@/lib/auth-client'
import { getUserColor } from '@/app/workspace/[workspaceId]/w/utils/get-user-color'
import { useSocket } from '@/contexts/socket-context'

interface AvatarsProps {
  workflowId: string
  maxVisible?: number
  /**
   * Callback fired when the presence visibility changes.
   * Used by parent components to adjust layout (e.g., text truncation spacing).
   */
  onPresenceChange?: (hasAvatars: boolean) => void
}

interface PresenceUser {
  socketId: string
  userId: string
  userName?: string
  avatarUrl?: string | null
}

interface UserAvatarProps {
  user: PresenceUser
  index: number
}

/**
 * Individual user avatar with error handling for image loading.
 * Falls back to colored circle with initials if image fails to load.
 */
function UserAvatar({ user, index }: UserAvatarProps) {
  const [imageError, setImageError] = useState(false)
  const color = getUserColor(user.userId)
  const initials = user.userName ? user.userName.charAt(0).toUpperCase() : '?'
  const hasAvatar = Boolean(user.avatarUrl) && !imageError

  // Reset error state when avatar URL changes
  useEffect(() => {
    setImageError(false)
  }, [user.avatarUrl])

  const avatarElement = (
    <div
      className='relative flex h-[14px] w-[14px] flex-shrink-0 cursor-default items-center justify-center overflow-hidden rounded-full font-semibold text-[7px] text-white'
      style={
        {
          background: hasAvatar ? undefined : color,
          zIndex: 10 - index,
        } as CSSProperties
      }
    >
      {hasAvatar && user.avatarUrl ? (
        <Image
          src={user.avatarUrl}
          alt={user.userName ? `${user.userName}'s avatar` : 'User avatar'}
          fill
          sizes='14px'
          className='object-cover'
          referrerPolicy='no-referrer'
          unoptimized={user.avatarUrl.startsWith('http')}
          onError={() => setImageError(true)}
        />
      ) : (
        initials
      )}
    </div>
  )

  if (user.userName) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{avatarElement}</Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <span>{user.userName}</span>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return avatarElement
}

/**
 * Displays user avatars for presence in a workflow item.
 * Only shows avatars for the currently active workflow.
 *
 * @param props - Component props
 * @returns Avatar stack for workflow presence
 */
export function Avatars({ workflowId, maxVisible = 3, onPresenceChange }: AvatarsProps) {
  const { presenceUsers, currentWorkflowId } = useSocket()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  /**
   * Only show presence for the currently active workflow
   * Filter out the current user from the list
   */
  const workflowUsers = useMemo(() => {
    if (currentWorkflowId !== workflowId) {
      return []
    }
    return presenceUsers.filter((user) => user.userId !== currentUserId)
  }, [presenceUsers, currentWorkflowId, workflowId, currentUserId])

  /**
   * Calculate visible users and overflow count
   */
  const { visibleUsers, overflowCount } = useMemo(() => {
    if (workflowUsers.length === 0) {
      return { visibleUsers: [], overflowCount: 0 }
    }

    const visible = workflowUsers.slice(0, maxVisible)
    const overflow = Math.max(0, workflowUsers.length - maxVisible)

    return { visibleUsers: visible, overflowCount: overflow }
  }, [workflowUsers, maxVisible])

  // Notify parent when avatars are present or not
  useEffect(() => {
    const hasAnyAvatars = visibleUsers.length > 0
    if (typeof onPresenceChange === 'function') {
      onPresenceChange(hasAnyAvatars)
    }
  }, [visibleUsers, onPresenceChange])

  if (visibleUsers.length === 0) {
    return null
  }

  return (
    <div className='-space-x-1 ml-[-8px] flex items-center'>
      {visibleUsers.map((user, index) => (
        <UserAvatar key={user.socketId} user={user} index={index} />
      ))}

      {overflowCount > 0 && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div
              className='relative flex h-[14px] w-[14px] flex-shrink-0 cursor-default items-center justify-center overflow-hidden rounded-full bg-[#404040] font-semibold text-[7px] text-white'
              style={{ zIndex: 10 - visibleUsers.length } as CSSProperties}
            >
              +{overflowCount}
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>
            {overflowCount} more user{overflowCount > 1 ? 's' : ''}
          </Tooltip.Content>
        </Tooltip.Root>
      )}
    </div>
  )
}
