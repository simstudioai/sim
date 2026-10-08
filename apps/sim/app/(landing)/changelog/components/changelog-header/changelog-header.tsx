import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { LANDING_TYPE } from '@/app/(landing)/components/landing-layout'

interface ChangelogHeaderProps {
  title: string
  lead: string
  actions?: ReactNode
}

export function ChangelogHeader({ title, lead, actions }: ChangelogHeaderProps) {
  return (
    <header className='flex flex-col items-start gap-6'>
      <h1 className={cn('text-[var(--text-primary)]', LANDING_TYPE.h1)}>{title}</h1>
      <p className={cn('max-w-[640px] text-[var(--text-secondary)]', LANDING_TYPE.lead)}>{lead}</p>
      {actions}
    </header>
  )
}
