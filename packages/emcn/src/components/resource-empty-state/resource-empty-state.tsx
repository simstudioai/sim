import type { ComponentType } from 'react'

export interface ResourceEmptyStateProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
}

/**
 * Centered resource-empty state for a page or panel. The caller owns loading and
 * access decisions; this component only presents the unavailable-resource message.
 * @example <ResourceEmptyState icon={FileX} title='File not found' description='This file may have been deleted or moved' />
 */
export function ResourceEmptyState({ icon: Icon, title, description }: ResourceEmptyStateProps) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 text-center'>
      <Icon className='size-[32px] text-[var(--text-icon)]' />
      <div className='flex flex-col items-center gap-1'>
        <h2 className='text-[var(--text-primary)] text-xl leading-[inherit]'>{title}</h2>
        <p className='text-[var(--text-body)] text-small'>{description}</p>
      </div>
    </div>
  )
}
