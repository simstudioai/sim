'use client'

import { MenuItem } from '@sim/emcn/menu/action-menu'
import { useHasPendingInvitations } from '@/platform/lib/data/invitations'

interface ViewInvitationsItemProps {
  onOpen: () => void
}

/**
 * The organization menu's View invitations entry, offered only while the viewer has pending
 * invitations. It mounts with the open menu, so the read runs then and is cached between opens.
 */
export function ViewInvitationsItem({ onOpen }: ViewInvitationsItemProps) {
  const hasInvitations = useHasPendingInvitations()
  if (!hasInvitations) return null
  return <MenuItem label='View invitations' icon='I133' onSelect={onOpen} />
}
