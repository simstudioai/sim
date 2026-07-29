'use client'

import { Chip, ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { InvitationDetails } from '@/lib/api/contracts/invitations'
import { getInvitationErrorMessage } from '@/lib/invitations/error-messages'
import {
  useAcceptMyInvitation,
  useDeclineMyInvitation,
  useMyPendingInvitations,
} from '@/hooks/queries/invitations'

const logger = createLogger('ViewInvitationsModal')

/**
 * Display name for an invitation, mirroring the /invite page: organization
 * invites are labeled by the org (even when workspace grants ride along);
 * workspace invites by their workspace(s).
 */
function invitationLabel(inv: InvitationDetails): string {
  if (inv.kind === 'organization') {
    return inv.organizationName ?? 'Organization'
  }
  const first = inv.grants[0]?.workspaceName
  if (first) {
    const extra = inv.grants.length - 1
    return extra > 0 ? `${first} +${extra}` : first
  }
  return 'Workspace'
}

/** Secondary line: who invited, plus role (org) or permission (workspace). */
function invitationSubLabel(inv: InvitationDetails): string {
  const invitedBy = inv.inviterName ? `Invited by ${inv.inviterName}` : 'Invited'
  const detail = inv.kind === 'organization' ? inv.role : inv.grants[0]?.permission
  return detail ? `${invitedBy} · ${detail}` : invitedBy
}

interface ViewInvitationsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The invitee-facing pending-invitations modal, opened from the workspace
 * switcher's "View invitations" entry. Accepting is session-bound (no token),
 * so it works regardless of which browser the invite email was opened in —
 * including the desktop app. Accepting closes the modal and navigates into
 * the joined workspace; declining keeps it open for the remaining rows.
 */
export function ViewInvitationsModal({ open, onOpenChange }: ViewInvitationsModalProps) {
  const { data: invitations } = useMyPendingInvitations(open)
  const acceptInvitation = useAcceptMyInvitation()
  const declineInvitation = useDeclineMyInvitation()
  const router = useRouter()

  const isBusy = acceptInvitation.isPending || declineInvitation.isPending

  const handleAccept = async (inv: InvitationDetails) => {
    try {
      const result = await acceptInvitation.mutateAsync({ invitationId: inv.id })
      toast.success(`Joined ${invitationLabel(inv)}`)
      onOpenChange(false)
      router.push(result.redirectPath)
    } catch (error) {
      logger.error('Failed to accept invitation', { error })
      toast.error(
        getInvitationErrorMessage(
          getErrorMessage(error, ''),
          'Could not accept the invitation. It may have expired.'
        )
      )
    }
  }

  const handleDecline = async (inv: InvitationDetails) => {
    try {
      await declineInvitation.mutateAsync({ invitationId: inv.id })
    } catch (error) {
      logger.error('Failed to decline invitation', { error })
      toast.error(
        getInvitationErrorMessage(getErrorMessage(error, ''), 'Could not decline the invitation.')
      )
    }
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Pending invitations'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Invitations</ChipModalHeader>
      <ChipModalBody>
        {!invitations || invitations.length === 0 ? (
          <p className='px-2 text-[var(--text-muted)] text-sm'>No pending invitations.</p>
        ) : (
          invitations.map((inv) => (
            <div key={inv.id} className='flex items-center gap-2 px-2'>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[var(--text-body)] text-sm'>{invitationLabel(inv)}</p>
                <p className='truncate text-[var(--text-muted)] text-caption'>
                  {invitationSubLabel(inv)}
                </p>
              </div>
              <Chip
                variant='primary'
                disabled={isBusy}
                onClick={() => void handleAccept(inv)}
                className='flex-shrink-0'
              >
                Accept
              </Chip>
              <Chip
                disabled={isBusy}
                onClick={() => void handleDecline(inv)}
                aria-label={`Decline invitation to ${invitationLabel(inv)}`}
                className='flex-shrink-0'
              >
                Decline
              </Chip>
            </div>
          ))
        )}
      </ChipModalBody>
      <ChipModalFooter
        hideCancel
        onCancel={() => onOpenChange(false)}
        primaryAction={{ label: 'Done', onClick: () => onOpenChange(false) }}
      />
    </ChipModal>
  )
}
