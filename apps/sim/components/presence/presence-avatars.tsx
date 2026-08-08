'use client'

import { Avatar, AvatarFallback, AvatarImage, cn, Tooltip } from '@sim/emcn'
import { getUserColor } from '@/lib/workspaces/colors'

/** Minimal presence shape the avatar stack renders — shared by workflow and files. */
export interface PresenceAvatarUser {
  /** Unique id per presence entry, used as the render key: a socket id where presence is
   *  per-connection (workflow), absent where entries are deduped per user (file docs). */
  socketId?: string
  userId: string
  userName?: string
  avatarUrl?: string | null
}

interface UserAvatarProps {
  user: PresenceAvatarUser
  index: number
}

/**
 * A single collaborator avatar: their image, falling back to a colored circle
 * with their initial. Wrapped in a name tooltip when the name is known.
 */
function UserAvatar({ user, index }: UserAvatarProps) {
  const color = getUserColor(user.userId)
  const initials = user.userName ? user.userName.charAt(0).toUpperCase() : '?'

  const avatarElement = (
    <Avatar size='xs' style={{ zIndex: index + 1 }}>
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

interface PresenceAvatarsProps {
  /** Collaborators to show — already filtered to exclude the current socket. */
  users: PresenceAvatarUser[]
  /** Max avatars before collapsing the remainder into a "+N" chip. */
  maxVisible?: number
  /** Layout-only classes for the outer stack (e.g. surrounding margin); chrome is owned here. */
  className?: string
}

const DEFAULT_MAX_VISIBLE = 5

/**
 * Overlapping stack of collaborator avatars for presence. Presentational only —
 * the caller owns fetching/filtering presence (workflow sidebar item, files
 * header, etc.), so the stack looks identical everywhere it appears.
 */
export function PresenceAvatars({
  users,
  maxVisible = DEFAULT_MAX_VISIBLE,
  className,
}: PresenceAvatarsProps) {
  // Reverse so the rightmost avatar stays stable as new ones reveal on the left.
  // slice() already returns a fresh array, so the in-place reverse is safe.
  const visibleUsers = users.slice(0, maxVisible).reverse()
  const overflowCount = Math.max(0, users.length - maxVisible)

  if (visibleUsers.length === 0) {
    return null
  }

  return (
    <div className={cn('-space-x-1 flex flex-shrink-0 items-center', className)}>
      {overflowCount > 0 && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Avatar
              size='xs'
              style={{ zIndex: 0 }}
              aria-label={`${overflowCount} more ${overflowCount === 1 ? 'user' : 'users'}`}
            >
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
        <UserAvatar key={user.socketId ?? user.userId} user={user} index={index} />
      ))}
    </div>
  )
}
