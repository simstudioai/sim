import type { ComponentType, ReactNode } from 'react'

interface MenuPreviewHeaderProps {
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  actions?: ReactNode
}

interface MenuPreviewToolbarProps {
  children: ReactNode
}

/** Tables sets the shared title sizing and the visible crop's content width. */
export function MenuPreviewHeader({ icon: Icon, title, actions }: MenuPreviewHeaderProps) {
  return (
    <div data-menu-preview-header className='h-11 border-[var(--border)] border-b'>
      <div className='flex size-full max-w-[576px] items-center gap-2 px-4'>
        {Icon && <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
        <div className='flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap text-[var(--text-primary)] text-base'>
          {title}
        </div>
        {actions && (
          <div className='ml-auto flex shrink-0 items-center gap-1 text-[var(--text-muted)] text-small'>
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
      <div className='flex size-full max-w-[576px] items-center gap-1 px-2 text-small'>
        {children}
      </div>
    </div>
  )
}
