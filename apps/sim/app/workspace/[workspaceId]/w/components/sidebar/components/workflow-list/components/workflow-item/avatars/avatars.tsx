'use client'

import { type CSSProperties, useEffect, useMemo } from 'react'
import { Avatar, AvatarFallback, AvatarImage, Tooltip } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getUserColor } from '@/lib/workspaces/colors'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Avatar display configuration for responsive layout.
 */
const AVATAR_CONFIG = {
  MIN_COUNT: 3,
  MAX_COUNT: 12,
  WIDTH_PER_AVATAR: 20,
} as const

interface AvatarsProps {
  workflowId: string
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
        className='border-0 font-semibold text-[7px] text-white'
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
export function Avatars({ workflowId, onPresenceChange }: AvatarsProps) {
  const { presenceUsers, currentWorkflowId } = useSocket()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id
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
   * Filter out the current user from the list.
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
    <div className='-space-x-1 flex items-center'>
      {overflowCount > 0 && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Avatar size='xs' style={{ zIndex: 0 } as CSSProperties}>
              <AvatarFallback className='border-0 bg-[#404040] font-semibold text-[7px] text-white'>
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
        <UserAvatar key={user.socketId} user={user} index={overflowCount > 0 ? index + 1 : index} />
      ))}
    </div>
  )
}
