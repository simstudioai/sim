'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { MODULE_GUTTER_X } from '@/components/resources/interface-view/module-chrome'

export interface ModuleChooserProps {
  /**
   * Section label above the stack, in the sidebar's section-header style — the
   * app's one way of titling a list of chips.
   */
  title: string
  /** Full-width `Chip`s, or the single picker control that stands in for them. */
  children: ReactNode
}

/**
 * The centered column a module surface presents when it is being pointed at
 * something: the empty grid cell offering the four module types, and a placed
 * module offering the workspace resource it still needs.
 *
 * One component for both, so the surface a builder meets before picking a
 * module and the one they meet before picking its resource are the same shape:
 * same column width, same header, same rhythm.
 *
 * Carries no chrome beyond the header. The cell owns the frame — including any
 * dismiss affordance, which belongs to the surface being dismissed rather than
 * to the column it happens to contain — and every child owns its own surface.
 */
export function ModuleChooser({ title, children }: ModuleChooserProps) {
  return (
    <div
      className={cn(
        'flex size-full min-h-0 items-center justify-center overflow-auto py-4',
        MODULE_GUTTER_X
      )}
    >
      <div className='flex w-full max-w-[280px] flex-col gap-1.5'>
        {/** `h-[18px]` + muted `text-small`, matching the sidebar's "Chats" header exactly. */}
        <div className='flex h-[18px] flex-shrink-0 items-center px-2'>
          <div className='truncate text-[var(--text-muted)] text-small'>{title}</div>
        </div>
        {children}
      </div>
    </div>
  )
}
