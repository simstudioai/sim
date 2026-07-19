'use client'

import type { ComponentType, CSSProperties } from 'react'
import { cn } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'

export interface ActionRowProps {
  icon: ComponentType<{ className?: string; style?: CSSProperties }>
  /** Inline color for a brand icon rendered bare (e.g. `getBareIconStyle`). */
  iconStyle?: CSSProperties
  label: string
  onClick: () => void
  /** Draws the top divider — pass `index > 0` when stacking rows into a list. */
  divider?: boolean
}

/**
 * One "icon + label + chevron" action row — the canonical row chrome shared
 * by the home page's suggested actions and the interface module picker. The
 * row owns its chrome; consumers supply only content and the divider flag.
 */
export function ActionRow({
  icon: Icon,
  iconStyle,
  label,
  onClick,
  divider = false,
}: ActionRowProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-5)]',
        divider && 'border-t'
      )}
    >
      <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' style={iconStyle} />
      <span className='flex-1 truncate text-[var(--text-body)] text-sm'>{label}</span>
      <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}
