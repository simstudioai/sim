import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { DocsTitle } from 'fumadocs-ui/page'

interface PageHeaderProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function PageHeader({ title, icon, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-4 gap-y-2', className)}>
      <DocsTitle
        className={cn(
          'mb-2 min-w-0 flex-[1_1_16rem] [overflow-wrap:anywhere]',
          icon && 'flex items-center gap-3'
        )}
      >
        {icon}
        {icon ? <span className='min-w-0'>{title}</span> : title}
      </DocsTitle>
      <div className='ms-auto flex shrink-0 items-center gap-2 pt-1'>{children}</div>
    </div>
  )
}
