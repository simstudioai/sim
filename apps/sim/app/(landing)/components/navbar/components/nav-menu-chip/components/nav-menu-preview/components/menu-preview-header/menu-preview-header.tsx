import type { ComponentType, ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface MenuPreviewHeaderProps {
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  actions?: ReactNode
  size?: 'default' | 'table'
}

interface MenuPreviewToolbarProps {
  children: ReactNode
}

/** Preview frames can constrain header actions to their visible crop. */
export function MenuPreviewHeader({
  icon: Icon,
  title,
  actions,
  size = 'default',
}: MenuPreviewHeaderProps) {
  return (
    <div
      data-menu-preview-header
      className={cn(
        'shrink-0 border-[var(--border)] border-b',
        size === 'table' ? 'box-content h-10' : 'h-11'
      )}
    >
      <div className='flex size-full max-w-[var(--preview-content-width,100%)] items-center gap-2 px-4'>
        {Icon && <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
        <div className='flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap text-[var(--text-primary)] text-base'>
          {title}
        </div>
        {actions && (
          <div className='ml-auto flex shrink-0 items-center gap-1 text-[var(--text-secondary)] text-small'>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

/** Chip padding brings toolbar labels onto the title row's 16px inset. */
export function MenuPreviewToolbar({ children }: MenuPreviewToolbarProps) {
  return (
    <div data-menu-preview-toolbar className='h-[38px] border-[var(--border)] border-b'>
      <div className='flex size-full max-w-[var(--preview-content-width,100%)] items-center gap-1 px-2 text-small'>
        {children}
      </div>
    </div>
  )
}
