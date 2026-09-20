'use client'

import type { ReactNode } from 'react'
import { cn, Expandable, ExpandableContent } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'

interface HomeSectionProps {
  title: string
  expanded: boolean
  animationsEnabled: boolean
  onToggle: () => void
  children: ReactNode
}

/**
 * Home-page section with caller-owned expansion and animation timing.
 * Inner padding collapses with the content; margin would disappear on unmount and cause a jump.
 * Section hover or toggle focus reveals the chevron, preserving keyboard feedback when global
 * styles clear outlines. A shared transition keeps its fade and rotation synchronized.
 */
export function HomeSection({
  title,
  expanded,
  animationsEnabled,
  onToggle,
  children,
}: HomeSectionProps) {
  return (
    <div className='group/suggested mx-auto mt-7 w-full max-w-chat'>
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={expanded}
        className='group/toggle flex w-full cursor-pointer items-center gap-2'
      >
        <span className='text-[var(--text-muted)] text-caption'>{title}</span>
        <ChevronDown
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] opacity-0 transition-[opacity,transform] duration-150',
            'group-hover/suggested:opacity-100 group-focus-visible/toggle:opacity-100',
            !expanded && '-rotate-90'
          )}
        />
      </button>
      <Expandable expanded={expanded}>
        <ExpandableContent className={cn(!animationsEnabled && 'animate-none!')}>
          <div className='flex flex-col pt-1.5'>{children}</div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
