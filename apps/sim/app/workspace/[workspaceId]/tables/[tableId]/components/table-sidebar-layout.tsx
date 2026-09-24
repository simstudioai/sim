import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface TableSidebarShellProps {
  open: boolean
  'aria-label': string
  children: ReactNode
}

/** The shared sliding shell for table configuration sidebars. */
export function TableSidebarShell({
  open,
  children,
  'aria-label': ariaLabel,
}: TableSidebarShellProps) {
  return (
    <aside
      role='dialog'
      aria-label={ariaLabel}
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] transition-transform duration-200 ease-out',
        open ? 'translate-x-0 shadow-overlay' : 'translate-x-full'
      )}
    >
      {children}
    </aside>
  )
}

interface TableSidebarScrollBodyProps {
  children: ReactNode
}

/** The scrolling form area shared by column, workflow, and enrichment settings. */
export function TableSidebarScrollBody({ children }: TableSidebarScrollBodyProps) {
  return (
    <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [overflow-anchor:none]'>
      {children}
    </div>
  )
}
