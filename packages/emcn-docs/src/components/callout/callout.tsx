import type { HTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'

interface CalloutProps extends HTMLAttributes<HTMLElement> {
  type?: 'info' | 'warn' | 'warning' | 'error' | 'success' | 'note'
  title?: string
  icon?: ReactNode
}

export function Callout({
  type = 'info',
  title,
  icon,
  className,
  children,
  ...props
}: CalloutProps) {
  const glyph: IconName =
    type === 'success' ? 'I072' : type === 'warn' || type === 'warning' ? 'lock' : 'warning-circle'
  const inset = title?.toLowerCase() === 'before you begin'
  return (
    <aside
      {...props}
      className={cn(
        'my-6 flex min-w-0 items-start gap-3 py-1 text-[var(--docs-text)] text-docs-table',
        inset && 'gap-2 rounded-lg bg-[var(--docs-surface)] p-4',
        className
      )}
    >
      <span className='flex h-[22px] w-4 shrink-0 items-center justify-center text-[var(--docs-muted)]'>
        {icon ?? <Icon name={glyph} className='size-4' />}
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-1 [&>:last-child]:mb-0 [&>p]:my-0 [&>p]:text-docs-table'>
        {title && <p className='font-medium'>{title}</p>}
        {children}
      </div>
    </aside>
  )
}
