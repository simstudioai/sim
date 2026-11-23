'use client'

import { useRef, useState } from 'react'
import {
  Chip,
  ChipChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowText,
  Tooltip,
  toast,
} from '@sim/emcn'
import { PanelLeft, Send, Settings } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { InviteModal } from '@/app/workspace/[workspaceId]/components/invite-modal'
import { SidebarRenameRow } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-rename-row'
import { SIDEBAR_RAIL_CHIP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { holdRowFocus } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { useRenameOrganization } from '@/hooks/queries/organization'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'

function getOrganizationInitial(name: string): string {
  return (name.trim()[0] || 'O').toUpperCase()
}

interface OrganizationHeaderProps {
  organization: OrganizationSurfaceContext['organization']
  /** Organization admins may change its logo and name. */
  canEditIdentity: boolean
  canInviteMembers: boolean
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
 * Admins change the logo and rename the organization from the card.
 */
export function OrganizationHeader({
  organization,
  canEditIdentity,
  canInviteMembers,
  isCollapsed,
  onExpandSidebar,
}: OrganizationHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { mutate: uploadLogo, isPending: isUploadingLogo } = useUploadOrganizationLogo(
    organization.id
  )
  const renameOrganization = useRenameOrganization()
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [draftName, setDraftName] = useState<string | null>(null)
  /**
   * The name just saved, shown until the refreshed server prop replaces the one
   * it was saved over; without it the old name flashes back in between.
   */
  const [savedName, setSavedName] = useState<{ name: string; replaces: string } | null>(null)
  if (savedName && savedName.replaces !== organization.name) setSavedName(null)
  const organizationName = savedName?.name ?? organization.name
  const initial = getOrganizationInitial(organizationName)

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
  const stopRenaming = () => {
    setDraftName(null)
    renameOrganization.reset()
  }

  const submitRename = () => {
    if (draftName === null || renameOrganization.isPending) return
    const name = draftName.trim()
    if (!name || name === organizationName) {
      stopRenaming()
      return
    }
    renameOrganization.mutate(
      { orgId: organization.id, name },
      {
        onSuccess: () => {
          setSavedName({ name, replaces: organization.name })
          stopRenaming()
        },
        onError: () => requestAnimationFrame(() => nameInputRef.current?.focus()),
      }
    )
  }

  const logo = (
    <IdentityTile size='lg' initial={initial} logoUrl={organization.logo} alt={organizationName} />
  )

  return (
    <div className='min-w-0 flex-1'>
      {canEditIdentity && (
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
      <DropdownMenu
        open={isMenuOpen}
        onOpenChange={(open) => {
          // The input's blur saves the draft; closing now would unmount it and hide a failure.
          if (!open && draftName !== null) return
          setIsMenuOpen(open)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Chip
            aria-label='Organization menu'
            className='min-w-0 max-w-full'
            leftAdornment={<IdentityTile initial={initial} logoUrl={organization.logo} />}
            rightAdornment={<ChipChevronDown />}
          >
            {organizationName}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          side='bottom'
          sideOffset={8}
          className='w-64 max-w-[calc(100vw-24px)]'
          onPointerMoveCapture={draftName !== null ? holdRowFocus : undefined}
          onPointerOutCapture={draftName !== null ? holdRowFocus : undefined}
        >
          <div className='flex items-center gap-2 px-2 py-1.5'>
            {canEditIdentity ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenuItem
                    aria-label='Change organization logo'
                    aria-busy={isUploadingLogo}
                    textValue='Change organization logo'
                    className='h-auto shrink-0 p-0 hover-hover:opacity-70 focus-visible:opacity-70'
                    disabled={isUploadingLogo}
                    onSelect={(event) => {
                      event.preventDefault()
                      fileInputRef.current?.click()
                    }}
                  >
                    {logo}
                  </DropdownMenuItem>
                </Tooltip.Trigger>
                <Tooltip.Content>{isUploadingLogo ? 'Uploading' : 'Change logo'}</Tooltip.Content>
              </Tooltip.Root>
            ) : (
              logo
            )}
            <div className='flex min-w-0 flex-1 flex-col'>
              {draftName !== null ? (
                <SidebarRenameRow
                  ref={nameInputRef}
                  aria-label='Organization name'
                  aria-invalid={renameOrganization.isError || undefined}
                  autoFocus
                  value={draftName}
                  disabled={renameOrganization.isPending}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setDraftName(event.target.value)
                    if (renameOrganization.isError) renameOrganization.reset()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitRename()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      stopRenaming()
                    }
                  }}
                  onBlur={submitRename}
                />
              ) : canEditIdentity ? (
                <DropdownMenuItem
                  aria-label='Rename organization'
                  textValue='Rename organization'
                  className='h-auto min-w-0 p-0 hover-hover:opacity-70 focus-visible:opacity-70'
                  onSelect={(event) => {
                    event.preventDefault()
                    setDraftName(organizationName)
                  }}
                >
                  <OverflowText label={organizationName} />
                </DropdownMenuItem>
              ) : (
                <OverflowText label={organizationName} />
              )}
              {renameOrganization.isError && (
                <span role='alert' className='text-[var(--text-error)] text-caption'>
                  {getErrorMessage(renameOrganization.error, 'Failed to rename organization')}
                </span>
              )}
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
          {canInviteMembers && (
            <DropdownMenuItem onSelect={() => setIsInviteModalOpen(true)}>
              <Send className='size-[14px]' />
              Invite people
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {isInviteModalOpen && (
        <InviteModal
          open={isInviteModalOpen}
          onOpenChange={setIsInviteModalOpen}
          organizationId={organization.id}
          isOrganizationAdmin={canEditIdentity}
          canInvite={canInviteMembers}
        />
      )}
    </div>
  )
}
