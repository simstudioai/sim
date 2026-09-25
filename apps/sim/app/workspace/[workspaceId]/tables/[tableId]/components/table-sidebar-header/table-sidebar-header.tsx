import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { Button } from '@sim/emcn'

interface TableSidebarHeaderProps {
  children: ReactNode
}

/** Shared header row for table configuration sidebars. */
export function TableSidebarHeader({ children }: TableSidebarHeaderProps) {
  return (
    <div className='flex min-h-[48px] items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
      {children}
    </div>
  )
}

interface TableSidebarHeaderActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
}

/** Button treatment for actions in a table sidebar header. */
export const TableSidebarHeaderAction = forwardRef<
  HTMLButtonElement,
  TableSidebarHeaderActionProps
>(({ className, ...props }, ref) => (
  <Button
    {...props}
    ref={ref}
    variant='ghost'
    size='sm'
    iconSize='regular'
    iconPadding='sm'
    focusRing='muted'
    className={className}
  />
))

TableSidebarHeaderAction.displayName = 'TableSidebarHeaderAction'
