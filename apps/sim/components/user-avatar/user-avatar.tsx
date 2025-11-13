'use client'

import { type CSSProperties, useEffect, useState } from 'react'
import Image from 'next/image'
import { getUserColor } from '@/app/workspace/[workspaceId]/w/utils/get-user-color'

interface UserAvatarProps {
  userId: string
  userName?: string | null
  avatarUrl?: string | null
  size?: number
  className?: string
}

/**
 * Reusable user avatar component with error handling for image loading.
 * Falls back to colored circle with initials if image fails to load or is not available.
 */
export function UserAvatar({
  userId,
  userName,
  avatarUrl,
  size = 32,
  className = '',
}: UserAvatarProps) {
  const [imageError, setImageError] = useState(false)
  const color = getUserColor(userId)
  const initials = userName ? userName.charAt(0).toUpperCase() : '?'
  const hasAvatar = Boolean(avatarUrl) && !imageError

  // Reset error state when avatar URL changes
  useEffect(() => {
    setImageError(false)
  }, [avatarUrl])

  const fontSize = Math.max(10, size / 2.5)

  return (
    <div
      className={`relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ${className}`}
      style={
        {
          background: hasAvatar ? undefined : color,
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${fontSize}px`,
        } as CSSProperties
      }
    >
      {hasAvatar && avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={userName ? `${userName}'s avatar` : 'User avatar'}
          fill
          sizes={`${size}px`}
          className='object-cover'
          referrerPolicy='no-referrer'
          unoptimized={avatarUrl.startsWith('http')}
          onError={() => setImageError(true)}
        />
      ) : (
        initials
      )}
    </div>
  )
}
