'use client'

import { type CSSProperties, useMemo } from 'react'
import Image from 'next/image'
import { Tooltip } from '@/components/emcn'
import { getPresenceColors } from '@/lib/collaboration/presence-colors'

interface AvatarProps {
  connectionId: string | number
  name?: string
  color?: string
  avatarUrl?: string | null
  tooltipContent?: React.ReactNode | null
  size?: 'sm' | 'md' | 'lg'
  index?: number // Position in stack for z-index
}

export function UserAvatar({
  connectionId,
  name,
  color,
  avatarUrl,
  tooltipContent,
  size = 'md',
  index = 0,
}: AvatarProps) {
  const { gradient } = useMemo(() => getPresenceColors(connectionId, color), [connectionId, color])

  const sizeClass = {
    sm: 'h-5 w-5 text-[10px]',
    md: 'h-7 w-7 text-xs',
    lg: 'h-9 w-9 text-sm',
  }[size]

  const pixelSize = {
    sm: 20,
    md: 28,
    lg: 36,
  }[size]

  const initials = name ? name.charAt(0).toUpperCase() : '?'
  const hasAvatar = Boolean(avatarUrl)

  const avatarElement = (
    <div
      className={`
        ${sizeClass} relative flex flex-shrink-0 cursor-default items-center justify-center overflow-hidden rounded-full border-2 border-white font-semibold text-white shadow-sm `}
      style={
        {
          background: hasAvatar ? undefined : gradient,
          zIndex: 10 - index,
        } as CSSProperties
      }
    >
      {hasAvatar && avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name ? `${name}'s avatar` : 'User avatar'}
          fill
          sizes={`${pixelSize}px`}
          className='object-cover'
          referrerPolicy='no-referrer'
          unoptimized={avatarUrl.startsWith('http')}
        />
      ) : (
        initials
      )}
    </div>
  )

  if (tooltipContent) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{avatarElement}</Tooltip.Trigger>
        <Tooltip.Content side='bottom' className='max-w-xs'>
          {tooltipContent}
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return avatarElement
}
