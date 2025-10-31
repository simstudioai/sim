'use client'

import { type CSSProperties, useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getPresenceColors } from '@/lib/collaboration/presence-colors'

interface AvatarProps {
  connectionId: string | number
  name?: string
  color?: string
  tooltipContent?: React.ReactNode | null
  size?: 'sm' | 'md' | 'lg'
  index?: number // Position in stack for z-index
}

export function UserAvatar({
  connectionId,
  name,
  color,
  tooltipContent,
  size = 'md',
  index = 0,
}: AvatarProps) {
  const { gradient } = useMemo(() => getPresenceColors(connectionId, color), [connectionId, color])

  // Determine avatar size
  const sizeClass = {
    sm: 'h-5 w-5 text-[10px]',
    md: 'h-7 w-7 text-xs',
    lg: 'h-9 w-9 text-sm',
  }[size]

  const initials = name ? name.charAt(0).toUpperCase() : '?'

  const avatarElement = (
    <div
      className={`
        ${sizeClass} flex flex-shrink-0 cursor-default items-center justify-center rounded-full border-2 border-white font-semibold text-white shadow-sm `}
      style={
        {
          background: gradient,
          zIndex: 10 - index, // Higher index = lower z-index for stacking effect
        } as CSSProperties
      }
    >
      {initials}
    </div>
  )

  // If tooltip content is provided, wrap in tooltip
  if (tooltipContent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{avatarElement}</TooltipTrigger>
        <TooltipContent side='bottom' className='max-w-xs'>
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    )
  }

  return avatarElement
}
