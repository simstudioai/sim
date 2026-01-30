'use client'

import { type CSSProperties, useMemo } from 'react'
import { Avatar, AvatarFallback, AvatarImage, Tooltip } from '@/components/emcn'
import { getUserColor } from '@/lib/workspaces/colors'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Avatar display configuration for responsive layout.
 */
const AVATAR_CONFIG = {
  MIN_COUNT: 4,
  MAX_COUNT: 12,
  WIDTH_PER_AVATAR: 20,
} as const

interface AvatarsProps {
  workflowId: string
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
 * Individual user avatar using emcn Avatar component.
 * Falls back to colored circle with initials if image fails to load.
 */
function UserAvatar({ user, index }: UserAvatarProps) {
  const color = getUserColor(user.userId)
  const initials = user.userName ? user.userName.charAt(0).toUpperCase() : '?'

  const avatarElement = (
    <Avatar size='xs' style={{ zIndex: index + 1 } as CSSProperties}>
      {user.avatarUrl && (
        <AvatarImage
          src={user.avatarUrl}
          alt={user.userName ? `${user.userName}'s avatar` : 'User avatar'}
          referrerPolicy='no-referrer'
        />
      )}
      <AvatarFallback
        style={{ background: color }}
        className='border-0 font-semibold text-[7px] text-white leading-none'
      >
        {initials}
      </AvatarFallback>
    </Avatar>
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
export function Avatars({ workflowId }: AvatarsProps) {
  const { presenceUsers, currentWorkflowId, currentSocketId } = useSocket()
  const sidebarWidth = useSidebarStore((state) => state.sidebarWidth)

  /**
   * Calculate max visible avatars based on sidebar width.
   * Scales between MIN_COUNT and MAX_COUNT as sidebar expands.
   */
  const maxVisible = useMemo(() => {
    const widthDelta = sidebarWidth - SIDEBAR_WIDTH.MIN
    const additionalAvatars = Math.floor(widthDelta / AVATAR_CONFIG.WIDTH_PER_AVATAR)
    const calculated = AVATAR_CONFIG.MIN_COUNT + additionalAvatars
    return Math.max(AVATAR_CONFIG.MIN_COUNT, Math.min(AVATAR_CONFIG.MAX_COUNT, calculated))
  }, [sidebarWidth])

  /**
   * Only show presence for the currently active workflow.
   * Filter out the current socket connection (allows same user's other tabs to appear).
   */
  const workflowUsers = useMemo(() => {
    if (currentWorkflowId !== workflowId) {
      return []
    }
    return presenceUsers.filter((user) => user.socketId !== currentSocketId)
  }, [presenceUsers, currentWorkflowId, workflowId, currentSocketId])

  /**
   * Calculate visible users and overflow count.
   * Shows up to maxVisible avatars, with overflow indicator for any remaining.
   * Users are reversed so new avatars appear on the left (keeping right side stable).
   */
  const { visibleUsers, overflowCount } = useMemo(() => {
    if (workflowUsers.length === 0) {
      return { visibleUsers: [], overflowCount: 0 }
    }

    const visible = workflowUsers.slice(0, maxVisible)
    const overflow = Math.max(0, workflowUsers.length - maxVisible)

    // Reverse so rightmost avatars stay stable as new ones are revealed on the left
    return { visibleUsers: [...visible].reverse(), overflowCount: overflow }
  }, [workflowUsers, maxVisible])

  if (visibleUsers.length === 0) {
    return null
  }

  return (
    <div className='-space-x-1 flex flex-shrink-0 items-center'>
      {overflowCount > 0 && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Avatar size='xs' style={{ zIndex: 0 } as CSSProperties}>
              <AvatarFallback className='border-0 bg-[#404040] font-semibold text-[7px] text-white leading-none'>
                +{overflowCount}
              </AvatarFallback>
            </Avatar>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>
            {overflowCount} more user{overflowCount > 1 ? 's' : ''}
          </Tooltip.Content>
        </Tooltip.Root>
      )}
      {visibleUsers.map((user, index) => (
        <UserAvatar key={user.socketId} user={user} index={index} />
      ))}
    </div>
  )
}
