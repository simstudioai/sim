'use client'

import { useState } from 'react'
import { chipVariants, cn, OverflowText } from '@sim/emcn'
import { Workspaces } from '@sim/emcn/icons'
import Link from 'next/link'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import { WorkspacesRailFlyout } from '@/app/o/[organizationId]/components/organization-sidebar/components/workspaces-rail-flyout'
import { useOrganizationWorkspaces } from '@/app/o/[organizationId]/components/organization-sidebar/hooks'
import {
  CollapsedSidebarMenu,
  SidebarSection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

/** Rows shown at first, and added per "See more" — the workspace sidebar's Chats paging. */
const PAGE_SIZE = 5

interface WorkspacesSectionProps {
  organizationId: string
  isCollapsed: boolean
  pathname: string | null
  onContextMenu: (e: React.MouseEvent, href: string) => void
}

/**
 * The organization's workspaces the viewer belongs to: the first section of the
 * scroll region, so it carries no section gap — the divider padding above it is
 * the whole distance, exactly as the workspace sidebar spaces its own Chats.
 * Expanded, five rail chips and a muted "See more" that pages the rest in, the way
 * the workspace sidebar pages its Chats; collapsed, a hover flyout off the rail glyph.
 */
export function WorkspacesSection({
  organizationId,
  isCollapsed,
  pathname,
  onContextMenu,
}: WorkspacesSectionProps) {
  const hover = useHoverMenu()
  const { workspaces, isLoading } = useOrganizationWorkspaces(organizationId)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const hasMore = workspaces.length > visibleCount

  return (
    <SidebarSection title='Workspaces' railCollapsed={isCollapsed} className='shrink-0'>
      {isCollapsed ? (
        <div className='px-2'>
          <CollapsedSidebarMenu
            icon={<Workspaces className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
            hover={hover}
            ariaLabel='Workspaces'
          >
            <WorkspacesRailFlyout organizationId={organizationId} />
          </CollapsedSidebarMenu>
        </div>
      ) : (
        <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
          {!isLoading && workspaces.length === 0 && (
            <div className='flex h-[30px] items-center px-2 text-[var(--text-muted)] text-small'>
              No workspaces yet
            </div>
          )}
          {workspaces.slice(0, visibleCount).map((workspace) => {
            const href = `/workspace/${workspace.id}`
            return (
              <Link
                key={workspace.id}
                href={href}
                className={chipVariants({ active: pathname === href, fullWidth: true })}
                onContextMenu={(e) => onContextMenu(e, href)}
              >
                <IdentityTile
                  initial={getWorkspaceInitial(workspace.name)}
                  logoUrl={workspace.logoUrl}
                />
                <OverflowText label={workspace.name} className='flex-1 text-[var(--text-body)]' />
              </Link>
            )
          })}
          {workspaces.length > PAGE_SIZE && (
            <button
              type='button'
              onClick={() => setVisibleCount((count) => (hasMore ? count + PAGE_SIZE : PAGE_SIZE))}
              className={cn(
                chipVariants({ fullWidth: true }),
                'text-[var(--text-muted)] text-small'
              )}
            >
              {hasMore ? 'See more' : 'See less'}
            </button>
          )}
        </div>
      )}
    </SidebarSection>
  )
}
