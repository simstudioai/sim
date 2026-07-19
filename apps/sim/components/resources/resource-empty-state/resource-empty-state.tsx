import type { ComponentType } from 'react'

export interface ResourceEmptyStateProps {
  icon: ComponentType<{ className?: string }>
  /**
   * The headline, when this fills a whole view — "File not found", "Couldn't
   * load scheduled task". Omit it inside a cell that already has a title bar:
   * a titled state is a page telling you why it is blank, an untitled one is a
   * placeholder inside a frame that is already labelled.
   */
  title?: string
  /** The one sentence explaining the state. Always present. */
  description: string
}

/**
 * The placeholder every resource view falls back to — nothing configured, a
 * reference to something since deleted, no access, or an empty result.
 *
 * It draws its **interior only** and fills its parent: the frame (border,
 * radius, selection ring, title bar) belongs to whatever mounted it.
 */
export function ResourceEmptyState({ icon: Icon, title, description }: ResourceEmptyStateProps) {
  if (!title) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2 p-4 text-center'>
        <Icon className='size-[20px] text-[var(--text-icon)]' />
        <p className='text-[var(--text-placeholder)] text-small'>{description}</p>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-3'>
      <Icon className='size-[32px] text-[var(--text-icon)]' />
      <div className='flex flex-col items-center gap-1'>
        <h2 className='font-medium text-[20px] text-[var(--text-primary)]'>{title}</h2>
        <p className='text-[var(--text-body)] text-small'>{description}</p>
      </div>
    </div>
  )
}
