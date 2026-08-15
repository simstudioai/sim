'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  type ChipModalFooterSlotAction,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { Member } from '@/lib/workspaces/organization'
import {
  ORGANIZATION_ROLE_LABELS,
  type OrganizationMemberRole,
  type OrganizationRosterRow,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/member-rows'
import {
  useCancelInvitation,
  useResendInvitation,
  useUpdateOrganizationMemberRole,
} from '@/hooks/queries/organization'

const ORGANIZATION_ROLE_OPTIONS = [
  { value: 'admin', label: ORGANIZATION_ROLE_LABELS.admin },
  { value: 'member', label: ORGANIZATION_ROLE_LABELS.member },
] as const

const RETRY_HINT = 'Please try again in a moment.'

interface ManageAccessModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  /** The row whose access is being managed. Remount on change via a `key`. */
  row: OrganizationRosterRow
  /** Whether the viewer administers the organization. */
  canManage: boolean
  currentUserId: string
  /** Opens the shared removal confirmation, which owns the credential-impact disclosure. */
  onRemoveMember: (member: Member) => void
  /** Opens the shared ownership-transfer dialog. */
  onTransferOwnership: () => void
}

/**
 * Every per-member action for one roster row: the organization role plus the
 * destructive exits. A member gets a role change behind Save and a removal (or
 * a transfer/leave when the row is the viewer); a pending invitation gets
 * resend and revoke instead of a role change.
 *
 * The role control is disabled with a reason wherever the route would refuse
 * the change, so the modal never offers an edit that can only fail.
 */
export function ManageAccessModal({
  open,
  onOpenChange,
  organizationId,
  row,
  canManage,
  currentUserId,
  onRemoveMember,
  onTransferOwnership,
}: ManageAccessModalProps) {
  const [role, setRole] = useState<OrganizationMemberRole>(row.role)

  const updateMemberRole = useUpdateOrganizationMemberRole()
  const resendInvitation = useResendInvitation()
  const cancelInvitation = useCancelInvitation()

  const isSelf = row.kind === 'member' && row.member.userId === currentUserId
  const isOwner = row.role === 'owner'

  const roleLockReason = !canManage
    ? 'Only organization admins can change roles.'
    : row.kind === 'invitation'
      ? "A pending invitation's role is set when the invite is sent."
      : isOwner
        ? "The organization owner's role cannot be changed."
        : isSelf
          ? 'You cannot change your own role.'
          : row.role === 'external'
            ? 'External members keep a fixed role.'
            : null

  const isRoleLocked = roleLockReason !== null
  const roleOptions = isRoleLocked
    ? [{ value: row.role, label: ORGANIZATION_ROLE_LABELS[row.role] }]
    : ORGANIZATION_ROLE_OPTIONS

  const close = () => onOpenChange(false)

  const handleRoleChange = (value: string) => {
    if (value === 'admin' || value === 'member') setRole(value)
  }

  const handleSave = () => {
    if (row.kind !== 'member') return
    if (role !== 'admin' && role !== 'member') return

    updateMemberRole.mutate(
      { orgId: organizationId, userId: row.member.userId, role },
      {
        onSuccess: close,
        onError: (error) =>
          toast.error("Couldn't update role", {
            description: getErrorMessage(error, RETRY_HINT),
          }),
      }
    )
  }

  const handOffToDialog = (open: () => void) => {
    close()
    open()
  }

  const toRemovalTarget = (): Member | null => {
    if (row.kind !== 'member') return null
    return {
      id: row.member.memberId,
      role: row.member.role,
      user: {
        id: row.member.userId,
        name: row.member.name,
        email: row.member.email,
        image: row.member.image,
      },
    }
  }

  const handleRemove = () => {
    const target = toRemovalTarget()
    if (!target) return
    handOffToDialog(() => onRemoveMember(target))
  }

  const handleResend = () => {
    if (row.kind !== 'invitation') return
    resendInvitation.mutate(
      { invitationId: row.invitation.id, orgId: organizationId },
      {
        onSuccess: () => {
          toast.success('Invitation resent', { description: row.email })
          close()
        },
        onError: (error) =>
          toast.error("Couldn't resend invitation", {
            description: getErrorMessage(error, RETRY_HINT),
          }),
      }
    )
  }

  const handleRevoke = () => {
    if (row.kind !== 'invitation') return
    cancelInvitation.mutate(
      { invitationId: row.invitation.id, orgId: organizationId },
      {
        onSuccess: () => {
          toast.success('Invitation revoked', { description: row.email })
          close()
        },
        onError: (error) =>
          toast.error("Couldn't revoke invitation", {
            description: getErrorMessage(error, RETRY_HINT),
          }),
      }
    )
  }

  const isInvitationBusy = resendInvitation.isPending || cancelInvitation.isPending

  const secondaryActions: ChipModalFooterSlotAction[] =
    row.kind === 'invitation'
      ? canManage
        ? [
            {
              label: cancelInvitation.isPending ? 'Revoking...' : 'Revoke invite',
              variant: 'destructive',
              onClick: handleRevoke,
              disabled: isInvitationBusy,
            },
          ]
        : []
      : isSelf && isOwner
        ? [{ label: 'Transfer ownership', onClick: () => handOffToDialog(onTransferOwnership) }]
        : isSelf
          ? [{ label: 'Leave organization', variant: 'destructive', onClick: handleRemove }]
          : canManage && !isOwner
            ? [
                {
                  label: 'Remove from Organization',
                  variant: 'destructive',
                  onClick: handleRemove,
                },
              ]
            : []

  const primaryAction =
    row.kind === 'invitation'
      ? {
          label: resendInvitation.isPending ? 'Resending...' : 'Resend invite',
          onClick: handleResend,
          disabled: !canManage || isInvitationBusy,
        }
      : {
          label: updateMemberRole.isPending ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled: isRoleLocked || role === row.role || updateMemberRole.isPending,
        }

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Manage access'
      size='sm'
      dismissDisabled={updateMemberRole.isPending || isInvitationBusy}
    >
      <ChipModalHeader onClose={close}>Manage access</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='copy' title='Email' value={row.email} copyLabel='Copy email' />
        <ChipModalField
          type='dropdown'
          title='Role'
          value={role}
          onChange={handleRoleChange}
          options={roleOptions}
          disabled={isRoleLocked || updateMemberRole.isPending}
          hint={roleLockReason ?? undefined}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={updateMemberRole.isPending || isInvitationBusy}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
      />
    </ChipModal>
  )
}
