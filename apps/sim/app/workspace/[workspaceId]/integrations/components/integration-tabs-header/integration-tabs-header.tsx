import type { ReactNode } from 'react'
import { ChipLink } from '@/components/emcn'
import { SidebarToggle } from '@/app/workspace/[workspaceId]/components/sidebar-toggle'

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
    <div className='flex h-[44px] flex-shrink-0 items-center bg-[var(--bg)] px-4'>
      {/* The sidebar toggle matches ResourceHeader's 9px pull-out inside the
          canonical 44px bar, landing on the same 7px edge spot as every other
          page. The 44px bar keeps the 27px chips at the same 8.5px inset the
          old padding produced. */}
      <SidebarToggle className='-ml-[9px] mr-2' />
      <ChipLink href={`/workspace/${workspaceId}/integrations`} active={active === 'integrations'}>
        Integrations
      </ChipLink>
      <ChipLink href={`/workspace/${workspaceId}/skills`} active={active === 'skills'}>
        Skills
      </ChipLink>
      {rightSlot && <div className='ml-auto flex items-center'>{rightSlot}</div>}
    </div>
  )
}
