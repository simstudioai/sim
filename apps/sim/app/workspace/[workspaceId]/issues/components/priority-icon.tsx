import type { ComponentType } from 'react'
import { cn } from '@sim/emcn'
import type { IssuePriority } from '@/lib/issues/types'

interface GlyphProps {
  className?: string
}

/** Signal bars filled up to `level` of three, the way Linear draws low, medium, and high. */
function bars(level: 1 | 2 | 3): ComponentType<GlyphProps> {
  return function PriorityBars({ className }: GlyphProps) {
    return (
      <svg viewBox='0 0 16 16' aria-hidden='true' className={cn('size-[14px]', className)}>
        {[0, 1, 2].map((index) => (
          <rect
            key={index}
            x={2 + index * 4.5}
            y={10 - index * 3.5}
            width='3'
            height={4 + index * 3.5}
            rx='1'
            fill='currentColor'
            opacity={index < level ? 1 : 0.3}
          />
        ))}
      </svg>
    )
  }
}

function NoPriority({ className }: GlyphProps) {
  return (
    <svg viewBox='0 0 16 16' aria-hidden='true' className={cn('size-[14px]', className)}>
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={2 + index * 4.5}
          y='7.25'
          width='3'
          height='1.5'
          rx='0.75'
          fill='currentColor'
        />
      ))}
    </svg>
  )
}

function Urgent({ className }: GlyphProps) {
  return (
    <svg viewBox='0 0 16 16' aria-hidden='true' className={cn('size-[14px]', className)}>
      <rect x='1.5' y='1.5' width='13' height='13' rx='3' fill='currentColor' />
      <path
        d='M8 4.5v4.25M8 11.25v.25'
        stroke='var(--bg)'
        strokeWidth='1.75'
        strokeLinecap='round'
      />
    </svg>
  )
}

export const PRIORITY_ICONS: Record<IssuePriority, ComponentType<GlyphProps>> = {
  0: NoPriority,
  1: bars(1),
  2: bars(2),
  3: bars(3),
  4: Urgent,
}
