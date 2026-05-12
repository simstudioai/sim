import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'

interface IntegrationTabsHeaderProps {
  active: 'integrations' | 'skills'
  workspaceId: string
  rightSlot?: ReactNode
}

const TAB_BASE =
  'group mx-0.5 inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2 transition-colors'

export function IntegrationTabsHeader({
  active,
  workspaceId,
  rightSlot,
}: IntegrationTabsHeaderProps) {
  return (
    <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
      <Link
        href={`/workspace/${workspaceId}/integrations`}
        className={cn(
          TAB_BASE,
          active === 'integrations'
            ? 'bg-[var(--surface-active)]'
            : 'hover-hover:bg-[var(--surface-active)]'
        )}
      >
        <span className='text-[var(--text-body)] text-sm'>Integrations</span>
      </Link>
      <Link
        href={`/workspace/${workspaceId}/skills`}
        className={cn(
          TAB_BASE,
          active === 'skills'
            ? 'bg-[var(--surface-active)]'
            : 'hover-hover:bg-[var(--surface-active)]'
        )}
      >
        <span className='text-[var(--text-body)] text-sm'>Skills</span>
      </Link>
      {rightSlot && <div className='ml-auto flex items-center'>{rightSlot}</div>}
    </div>
  )
}
