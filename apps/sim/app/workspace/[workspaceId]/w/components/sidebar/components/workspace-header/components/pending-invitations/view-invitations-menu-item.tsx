'use client'

import { DropdownMenuItem } from '@sim/emcn'
import { Mail } from '@sim/emcn/icons'
import { useMyPendingInvitations } from '@/hooks/queries/invitations'

interface ViewInvitationsMenuItemProps {
  /** Close the workspace menu and open the invitations modal. */
  onOpen: () => void
}

/**
 * "View invitations" entry in the workspace switcher — rendered only when the
 * signed-in account has pending invitations. Mounted inside the dropdown
 * content, so the check runs when the menu opens (cached between opens).
 */
export function ViewInvitationsMenuItem({ onOpen }: ViewInvitationsMenuItemProps) {
  const { data: invitations } = useMyPendingInvitations()

  if (!invitations || invitations.length === 0) {
    return null
  }

  return (
    <DropdownMenuItem size='lg' onSelect={onOpen}>
      <Mail className='size-[14px]' />
      View invitations
    </DropdownMenuItem>
  )
}
