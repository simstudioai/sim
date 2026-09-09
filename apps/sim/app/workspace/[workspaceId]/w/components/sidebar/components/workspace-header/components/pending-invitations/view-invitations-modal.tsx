'use client'

import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  OverflowText,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { MyInvitation } from '@/lib/api/contracts/invitations'
import { getInvitationErrorMessage } from '@/lib/invitations/error-messages'
import { InvitationDisclosure } from '@/app/invite/components/invitation-disclosure'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
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
function invitationLabel(inv: MyInvitation): string {
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
function invitationSubLabel(inv: MyInvitation): string {
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
  const invitationsQuery = useMyPendingInvitations(open)
  const invitations = invitationsQuery.data ?? []
  const acceptInvitation = useAcceptMyInvitation()
  const declineInvitation = useDeclineMyInvitation()
  const router = useRouter()

  const isBusy = acceptInvitation.isPending || declineInvitation.isPending

  const handleAccept = async (inv: MyInvitation) => {
    if (isBusy || (inv.membershipIntent === 'internal' && !inv.joinPreview)) return
    try {
      const result = await acceptInvitation.mutateAsync({
        invitationId: inv.id,
        disclosedWorkspaceIds: inv.joinPreview?.workspaceIdsToMove,
        disclosedOutcome: inv.joinPreview?.outcome,
      })
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

  const handleDecline = async (inv: MyInvitation) => {
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
        {invitationsQuery.isError ? (
          <SettingsQueryErrorState
            error={invitationsQuery.error}
            fallback='Could not load invitations'
            isRetrying={invitationsQuery.isFetching}
            onRetry={() => void invitationsQuery.refetch()}
            variant='inline'
          />
        ) : invitationsQuery.isPending ? (
          <SettingsEmptyState variant='inline'>Loading invitations…</SettingsEmptyState>
        ) : invitations.length === 0 ? (
          <SettingsEmptyState variant='inline'>No pending invitations.</SettingsEmptyState>
        ) : (
          invitations.map((inv) => {
            const isDisclosureMissing = inv.membershipIntent === 'internal' && !inv.joinPreview
            return (
              <div key={inv.id} className='space-y-3'>
                <div className='flex items-center gap-2 px-2'>
                  <div className='min-w-0 flex-1'>
                    <OverflowText
                      label={invitationLabel(inv)}
                      className='block text-[var(--text-body)] text-sm'
                    />
                    <OverflowText
                      label={invitationSubLabel(inv)}
                      className='block text-[var(--text-muted)] text-caption'
                    />
                  </div>
                </div>
                <ChipModalField type='custom' title='Before you join'>
                  <InvitationDisclosure invitation={inv} joinPreview={inv.joinPreview} />
                  {isDisclosureMissing && (
                    <Chip
                      disabled={isBusy || invitationsQuery.isFetching}
                      onClick={() => void invitationsQuery.refetch()}
                    >
                      Refresh invitation
                    </Chip>
                  )}
                </ChipModalField>
                <div className='flex justify-end gap-2 px-2'>
                  <Chip
                    disabled={isBusy}
                    onClick={() => void handleDecline(inv)}
                    aria-label={`Decline invitation to ${invitationLabel(inv)}`}
                  >
                    Decline
                  </Chip>
                  <Chip
                    variant='primary'
                    disabled={isBusy || isDisclosureMissing}
                    onClick={() => void handleAccept(inv)}
                  >
                    Accept
                  </Chip>
                </div>
              </div>
            )
          })
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
