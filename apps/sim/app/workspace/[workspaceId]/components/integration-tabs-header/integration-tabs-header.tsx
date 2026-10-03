'use client'

import type { ReactNode } from 'react'
import { ChipLink, cn } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'

interface IntegrationTabsHeaderProps {
  active: 'integrations' | 'skills'
  workspaceId: string
  /** Trailing actions for the owning page (e.g. skills' "Add skill"). */
  rightSlot?: ReactNode
}

/** Shared navigation for workspace integrations and skills. */
export function IntegrationTabsHeader({
  active,
  workspaceId,
  rightSlot,
}: IntegrationTabsHeaderProps) {
  return (
    <div className={cn(PAGE_HEADER_BAR, 'gap-1')}>
      <ChipLink href={`/workspace/${workspaceId}/integrations`} active={active === 'integrations'}>
        Integrations
      </ChipLink>
      <ChipLink href={`/workspace/${workspaceId}/skills`} active={active === 'skills'}>
        Skills
      </ChipLink>
      {rightSlot && <div className={cn('ml-auto', HEADER_ACTION_CLUSTER)}>{rightSlot}</div>}
    </div>
  )
}
