import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface BulkActionBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Selection summary, including optional inline selection actions or limit warnings. */
  label: ReactNode
  children: ReactNode
}

/**
 * Shared selection-action surface. Callers own visibility, positioning, animation
 * and commands; compose actions with BulkActionButton.
 * @example <BulkActionBar label='2 selected'><BulkActionButton aria-label='Delete'><Trash /></BulkActionButton></BulkActionBar>
 */
export const BulkActionBar = forwardRef<HTMLDivElement, BulkActionBarProps>(
  ({ label, children, className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      className={cn(
        'flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5',
        className
      )}
    >
      <span className='px-1 text-[var(--text-secondary)] text-small'>{label}</span>
      <div className='flex items-center gap-[5px]'>{children}</div>
    </div>
  )
)

BulkActionBar.displayName = 'BulkActionBar'
