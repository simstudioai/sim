import type { ReactNode } from 'react'
import { ChipLink, cn } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'

interface IntegrationTabsHeaderProps {
  active: 'integrations' | 'skills'
  workspaceId: string
  /** Trailing actions for the owning page (e.g. skills' "Add skill"). */
  rightSlot?: ReactNode
}

/**
 * Top-of-page tab header shared by the Integrations and Skills pages — two halves
 * of one surface, so each highlights itself and links to its sibling.
 *
 * Lives in the shared workspace components rather than under `integrations/`
 * because both pages own it equally; its former home made Skills reach across into
 * a sibling feature for its own chrome.
 *
 * The `gap-1` is explicit because chips carry no outer margin — the parent owns the
 * space between them.
 */
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
