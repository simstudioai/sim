import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface EmptyStateProps {
  title: string
  description: string
  graphic?: ReactNode
  action?: ReactNode
  className?: string
}

/**
 * Shared platform empty-state frame with a visual, concise guidance, and an optional action.
 */
export function EmptyState({ title, description, graphic, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-8 text-center',
        className
      )}
    >
      {graphic ? <div className='mb-6 flex items-center justify-center'>{graphic}</div> : null}
      <p className='font-medium text-[var(--text-primary)] text-small'>{title}</p>
      <p className='mt-1 max-w-[240px] text-[var(--text-muted)] text-small leading-5'>
        {description}
      </p>
      {action ? <div className='mt-4 flex items-center justify-center gap-2'>{action}</div> : null}
    </div>
  )
}
