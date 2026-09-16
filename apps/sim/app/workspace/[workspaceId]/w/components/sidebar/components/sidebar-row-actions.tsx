import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface SidebarRowActionsProps {
  children: ReactNode
  indicator?: ReactNode
  open?: boolean
  revealOnHover?: boolean
}

/** Reclaims idle action space while retaining indicators and touch/keyboard access. */
export function SidebarRowActions({
  children,
  indicator,
  open = false,
  revealOnHover = true,
}: SidebarRowActionsProps) {
  return (
    <div
      className={cn(
        'relative size-[18px] shrink-0 items-center justify-center gap-1.5 [@media(hover:none)]:w-auto',
        indicator || open ? 'flex' : 'hidden',
        revealOnHover &&
          'group-focus-within/sidebar-row:flex group-hover/sidebar-row:flex [@media(hover:none)]:flex'
      )}
    >
      {indicator && (
        <span
          className={cn(
            'pointer-events-none flex size-[18px] shrink-0 items-center justify-center transition-opacity',
            open && '[@media(hover:hover)]:opacity-0',
            revealOnHover &&
              '[@media(hover:hover)]:group-focus-within/sidebar-row:opacity-0 [@media(hover:hover)]:group-hover/sidebar-row:opacity-0'
          )}
        >
          {indicator}
        </span>
      )}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity [@media(hover:none)]:static',
          open && 'pointer-events-auto opacity-100',
          revealOnHover &&
            'group-focus-within/sidebar-row:pointer-events-auto group-focus-within/sidebar-row:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100'
        )}
      >
        {children}
      </div>
    </div>
  )
}
