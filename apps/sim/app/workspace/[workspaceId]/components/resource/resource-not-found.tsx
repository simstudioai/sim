import type { ComponentType } from 'react'

interface ResourceNotFoundProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
}

/**
 * Full-page screen for a resource that could not be loaded and has no shell left to
 * draw — a knowledge base or a document that was deleted or moved.
 *
 * Distinct from the `emptyState` slot on {@link Resource.Table}: that one keeps the
 * chrome and reports a failure *within* a page that still exists. This replaces the
 * page, so it is only right when the thing the page is about is the thing that is gone.
 */
export function ResourceNotFound({ icon: Icon, title, description }: ResourceNotFoundProps) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3'>
      <Icon className='size-[32px] text-[var(--text-muted)]' />
      <div className='flex flex-col items-center gap-1'>
        <h2 className='text-[20px] text-[var(--text-secondary)]'>{title}</h2>
        <p className='text-[var(--text-muted)] text-small'>{description}</p>
      </div>
    </div>
  )
}
