'use client'

import {
  Chip,
  ChipChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { PanelLeft, Settings } from '@sim/emcn/icons'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import type { OrganizationSurfaceOrganization } from '@/lib/organizations/surface'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

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
 * its card — the mark at tile size, the name, how many people belong, and the way
 * into its settings; collapsed, it becomes the rail's expand control, swapping
 * the mark for a panel glyph on hover exactly as the workspace header does. The
 * mark is the organization's uploaded logo or its initial on the neutral tile.
 */
export function OrganizationHeader({
  organization,
  isCollapsed,
  onExpandSidebar,
}: OrganizationHeaderProps) {
  const initial = getOrganizationInitial(organization.name)

  if (isCollapsed) {
    return (
      <div className='min-w-0 flex-1'>
        <Chip
          aria-label='Expand sidebar'
          onClick={onExpandSidebar}
          fullWidth
          className={SIDEBAR_RAIL_CHIP_CLASS}
          leftAdornment={
            <div className='relative flex size-[16px] shrink-0 items-center justify-center'>
              <IdentityTile
                initial={initial}
                logoUrl={organization.logo}
                className='group-hover:invisible'
              />
              <PanelLeft
                aria-hidden
                className='pointer-events-none invisible absolute inset-0 m-auto size-[16px] rotate-180 text-[var(--text-icon)] group-hover:visible'
              />
            </div>
          }
        />
      </div>
    )
  }

  const { memberCount } = organization

  return (
    <div className='min-w-0 flex-1'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip
            aria-label='Organization menu'
            className='min-w-0 max-w-full'
            leftAdornment={<IdentityTile initial={initial} logoUrl={organization.logo} />}
            rightAdornment={<ChipChevronDown />}
          >
            {organization.name}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          side='bottom'
          sideOffset={8}
          className='w-64 max-w-[calc(100vw-24px)]'
        >
          {/* The item rows' `px-2` and the rail chips' icon-to-label gap, so the card sits on the menu's own grid. */}
          <div className='flex items-center gap-2 px-2 py-1.5'>
            <IdentityTile
              size='lg'
              initial={initial}
              logoUrl={organization.logo}
              alt={organization.name}
            />
            <div className='flex min-w-0 flex-col'>
              <span className='truncate text-[var(--text-primary)] text-sm'>
                {organization.name}
              </span>
              <span className='text-[var(--text-muted)] text-caption'>
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
            </div>
          </div>
          <DropdownMenuItem asChild>
            <SettingsGuardedLink href={getOrganizationSettingsHref(organization.id, 'members')}>
              <Settings className='size-[14px]' />
              Settings
            </SettingsGuardedLink>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
