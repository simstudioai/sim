import type { ReactNode } from 'react'
import { ChipLink, cn } from '@sim/emcn'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'

interface IntegrationTabsHeaderProps {
  active: 'integrations' | 'skills'
  workspaceId: string
  rightSlot?: ReactNode
}

/**
 * Top-of-page chip header shared by the Integrations and Skills pages.
 * Highlights the active tab and links to the sibling tab; `rightSlot` lets
 * each page render its own trailing actions (e.g. an "Add skill" button).
 */
export function IntegrationTabsHeader({
  active,
  workspaceId,
  rightSlot,
}: IntegrationTabsHeaderProps) {
  return (
    <div className={PAGE_HEADER_BAR}>
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
