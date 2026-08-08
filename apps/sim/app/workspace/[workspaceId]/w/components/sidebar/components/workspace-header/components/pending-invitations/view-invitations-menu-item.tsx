'use client'

import { Chip } from '@sim/emcn'
import { Mail } from '@sim/emcn/icons'
import { usePendingInvitationsForViewer } from '@/hooks/queries/invitations'

interface ViewInvitationsMenuItemProps {
  /** Close the workspace menu and open the invitations modal. */
  onOpen: () => void
}

/**
 * "View invitations" entry in the workspace switcher — rendered only when the
 * signed-in account has pending invitations. Mounted inside the dropdown
 * content, but the list is hydrated by the sidebar's server prefetch, so the
 * entry is there on the frame the menu opens instead of popping in after it.
 */
export function ViewInvitationsMenuItem({ onOpen }: ViewInvitationsMenuItemProps) {
  const { data: invitations } = usePendingInvitationsForViewer()

  if (!invitations || invitations.length === 0) {
    return null
  }

  return (
    <Chip leftIcon={Mail} onClick={onOpen} fullWidth className='select-none'>
      View invitations
    </Chip>
  )
}
