'use client'

import {
  ChipChevronDown,
  chipContentLabelClass,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  OverflowText,
} from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { OrganizationSurfaceOrganization } from '@/lib/organizations/surface'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { SIDEBAR_WIDTH } from '@/stores/constants'

function getOrganizationInitial(name: string): string {
  return (name.trim()[0] || 'O').toUpperCase()
}

interface OrganizationHeaderProps {
  organization: OrganizationSurfaceOrganization
  isCollapsed: boolean
  /** Expands the rail; the collapsed header is itself the expand control. */
  onExpandSidebar: () => void
}

/**
 * The top-left organization chip. Expanded, it names the organization and opens
 * the organization menu; collapsed, it becomes the rail's expand control, swapping
 * the mark for a panel glyph on hover exactly as the workspace header does. The
 * mark is the organization's uploaded logo or its initial on the neutral tile.
 */
export function OrganizationHeader({
  organization,
  isCollapsed,
  onExpandSidebar,
}: OrganizationHeaderProps) {
  if (isCollapsed) {
    return (
      <div className='min-w-0 flex-1'>
        <button
          type='button'
          aria-label='Expand sidebar'
          onClick={onExpandSidebar}
          className={cn(chipVariants({ fullWidth: true }), SIDEBAR_RAIL_CHIP_CLASS)}
        >
          <div className='relative flex size-[16px] shrink-0 items-center justify-center'>
            <IdentityTile
              initial={getOrganizationInitial(organization.name)}
              logoUrl={organization.logo}
              className='group-hover:invisible'
            />
            <PanelLeft
              aria-hidden
              className='pointer-events-none invisible absolute inset-0 m-auto size-[16px] rotate-180 text-[var(--text-icon)] group-hover:visible'
            />
          </div>
        </button>
      </div>
    )
  }

  return (
    <div className='min-w-0 flex-1'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            aria-label='Organization menu'
            className={cn(chipVariants(), 'min-w-0 max-w-full')}
          >
            <IdentityTile
              initial={getOrganizationInitial(organization.name)}
              logoUrl={organization.logo}
            />
            <OverflowText
              label={organization.name}
              className={cn('flex-1', chipContentLabelClass)}
              focusTarget='nearest-interactive'
            />
            <ChipChevronDown />
          </button>
        </DropdownMenuTrigger>
        {/* Sized like the workspace switcher so the two menus open to the same footprint. */}
        <DropdownMenuContent
          align='start'
          side='bottom'
          sideOffset={8}
          style={{ width: `${SIDEBAR_WIDTH.DEFAULT}px`, maxWidth: 'calc(100vw - 24px)' }}
          onCloseAutoFocus={(e) => e.preventDefault()}
        />
      </DropdownMenu>
    </div>
  )
}
