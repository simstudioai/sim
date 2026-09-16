import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { DocsTitle } from 'fumadocs-ui/page'

interface PageHeaderProps {
  title: string
  children: ReactNode
  className?: string
}

export function PageHeader({ title, children, className }: PageHeaderProps) {
  return (
    <div className={cn('mt-6 flex flex-wrap items-start gap-x-4 gap-y-2 sm:mt-0', className)}>
      <DocsTitle className='mb-2 min-w-0 flex-[1_1_16rem] [overflow-wrap:anywhere]'>
        {title}
      </DocsTitle>
      <div className='ms-auto flex shrink-0 items-center gap-2 pt-1'>{children}</div>
    </div>
  )
}
