'use client'

import { useRef } from 'react'
import {
  Chip,
  ChipChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowText,
  toast,
} from '@sim/emcn'
import { PanelLeft, Settings, Upload } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import type { OrganizationSurfaceOrganization } from '@/lib/organizations/surface'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'

function getOrganizationInitial(name: string): string {
  return (name.trim()[0] || 'O').toUpperCase()
}

interface OrganizationHeaderProps {
  organization: OrganizationSurfaceOrganization
  canEditLogo: boolean
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
  canEditLogo,
  isCollapsed,
  onExpandSidebar,
}: OrganizationHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { mutate: uploadLogo, isPending: isUploadingLogo } = useUploadOrganizationLogo(
    organization.id
  )
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
      {canEditLogo && (
        <input
          ref={fileInputRef}
          type='file'
          accept={LOGO_ACCEPT_ATTRIBUTE}
          className='hidden'
          aria-label='Organization logo'
          disabled={isUploadingLogo}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file || isUploadingLogo) return
            uploadLogo(file, {
              onSuccess: () => router.refresh(),
              onError: (error) => toast.error(error.message),
            })
          }}
        />
      )}
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
          <div className='flex items-center gap-2 px-2 py-1.5'>
            <IdentityTile
              size='lg'
              initial={initial}
              logoUrl={organization.logo}
              alt={organization.name}
            />
            <div className='flex min-w-0 flex-col'>
              <OverflowText label={organization.name} />
              <span className='text-[var(--text-muted)] text-caption'>
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
            </div>
          </div>
          {canEditLogo && (
            <DropdownMenuItem
              disabled={isUploadingLogo}
              onSelect={() => fileInputRef.current?.click()}
            >
              <Upload className='size-[14px]' />
              {isUploadingLogo ? 'Uploading...' : 'Upload logo'}
            </DropdownMenuItem>
          )}
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
