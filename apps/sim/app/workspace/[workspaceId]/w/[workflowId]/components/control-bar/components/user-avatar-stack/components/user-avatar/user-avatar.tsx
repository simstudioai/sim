'use client'

import { type CSSProperties, useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface AvatarProps {
  connectionId: string | number
  name?: string
  color?: string
  tooltipContent?: React.ReactNode | null
  size?: 'sm' | 'md' | 'lg'
  index?: number // Position in stack for z-index
}

// Color palette inspired by the app's design
const APP_COLORS = [
  { from: '#4F46E5', to: '#7C3AED' }, // indigo to purple
  { from: '#7C3AED', to: '#C026D3' }, // purple to fuchsia
  { from: '#EC4899', to: '#F97316' }, // pink to orange
  { from: '#14B8A6', to: '#10B981' }, // teal to emerald
  { from: '#6366F1', to: '#8B5CF6' }, // indigo to violet
  { from: '#F59E0B', to: '#F97316' }, // amber to orange
]

/**
 * Generate a deterministic gradient based on a connection ID
 */
function generateGradient(connectionId: string | number): string {
  // Convert connectionId to a number for consistent hashing
  const numericId =
    typeof connectionId === 'string'
      ? Math.abs(connectionId.split('').reduce((a, b) => a + b.charCodeAt(0), 0))
      : connectionId

  // Use the numeric ID to select a color pair from our palette
  const colorPair = APP_COLORS[numericId % APP_COLORS.length]

  // Add a slight rotation to the gradient based on connection ID for variety
  const rotation = (numericId * 25) % 360

  return `linear-gradient(${rotation}deg, ${colorPair.from}, ${colorPair.to})`
}

export function UserAvatar({
  connectionId,
  name,
  color,
  tooltipContent,
  size = 'md',
  index = 0,
}: AvatarProps) {
  // Generate a deterministic gradient for this user based on connection ID
  // Or use the provided color if available
  const backgroundStyle = useMemo(() => {
    if (color) {
      // If a color is provided, create a gradient with it
      const baseColor = color
      const lighterShade = color.startsWith('#')
        ? `${color}dd` // Add transparency for a lighter shade effect
        : color
      const darkerShade = color.startsWith('#') ? color : color

      return `linear-gradient(135deg, ${lighterShade}, ${darkerShade})`
    }
    // Otherwise, generate a gradient based on connectionId
    return generateGradient(connectionId)
  }, [connectionId, color])

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
          background: backgroundStyle,
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
