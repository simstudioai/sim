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
import {
  isWorkspaceAccessRemovable,
  WORKSPACE_ACCESS_LABELS,
  WORKSPACE_ACCESS_LEVELS,
  type WorkspaceAccessLevel,
  type WorkspaceAccessRow,
  workspaceAccessLockReason,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/roster-groups'
import {
  useCancelWorkspaceInvitation,
  useRemoveWorkspaceMember,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
import { useUpdateInvitation } from '@/hooks/queries/organization'

const ACCESS_OPTIONS = WORKSPACE_ACCESS_LEVELS.map((value) => ({
  value,
  label: WORKSPACE_ACCESS_LABELS[value],
}))

const RETRY_HINT = 'Please try again in a moment.'

interface WorkspaceAccessModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  workspaceId: string
  /** The row whose access is being managed. Remount on change via a `key`. */
  row: WorkspaceAccessRow
  /** Whether the viewer administers the organization. */
  canManage: boolean
  currentUserId: string
}

/**
 * Every per-person action for one row of a workspace's access list: the
 * permission this workspace grants them, plus the withdrawal of that grant.
 *
 * The counterpart of the members page's Manage access modal, and deliberately
 * the same shape — an identity field, one control behind Save, and the
 * destructive exit in the footer — so managing who is in a workspace reads
 * exactly like managing who is in the organization.
 *
 * Everything here is scoped to this one workspace. Removing a member leaves
 * their organization membership and every other workspace untouched; revoking
 * an invitation's grant leaves the invitation standing for whatever else it
 * grants.
 */
export function WorkspaceAccessModal({
  open,
  onOpenChange,
  organizationId,
  workspaceId,
  row,
  canManage,
  currentUserId,
}: WorkspaceAccessModalProps) {
  const [access, setAccess] = useState<WorkspaceAccessLevel>(row.access.permission)

  const updatePermissions = useUpdateWorkspacePermissions()
  const updateInvitation = useUpdateInvitation()
  const removeMember = useRemoveWorkspaceMember()
  const cancelInvitation = useCancelWorkspaceInvitation()

  const lockReason = workspaceAccessLockReason(row, { canManage, currentUserId })
  const isLocked = lockReason !== null
  const isRemovable = isWorkspaceAccessRemovable(row, { canManage, currentUserId })
  const isSaving = updatePermissions.isPending || updateInvitation.isPending
  const isRemoving = removeMember.isPending || cancelInvitation.isPending

  const close = () => onOpenChange(false)

  const handleAccessChange = (value: string) => {
    const next = WORKSPACE_ACCESS_LEVELS.find((level) => level === value)
    if (next) setAccess(next)
  }

  const report = (message: string) => (error: unknown) =>
    toast.error(message, { description: getErrorMessage(error, RETRY_HINT) })

  const handleSave = () => {
    if (isLocked || access === row.access.permission) return

    if (row.kind === 'invite') {
      updateInvitation.mutate(
        {
          orgId: organizationId,
          invitationId: row.invitationId,
          grants: [{ workspaceId, permission: access }],
        },
        { onSuccess: close, onError: report("Couldn't update invite access") }
      )
      return
    }

    updatePermissions.mutate(
      {
        workspaceId,
        organizationId,
        updates: [{ userId: row.member.userId, permissions: access }],
      },
      /**
       * `useUpdateWorkspacePermissions` raises its own toast — it carries the
       * route's validation detail, which is more specific than anything this
       * modal could say — so only the close is wired here.
       */
      { onSuccess: close }
    )
  }

  const handleRemove = () => {
    if (!isRemovable) return

    if (row.kind === 'invite') {
      cancelInvitation.mutate(
        { invitationId: row.invitationId, workspaceId, organizationId },
        {
          onSuccess: () => {
            toast.success('Revoked access to this workspace', { description: row.email })
            close()
          },
          onError: report("Couldn't revoke access"),
        }
      )
      return
    }

    removeMember.mutate(
      { userId: row.member.userId, workspaceId, organizationId },
      {
        onSuccess: () => {
          toast.success('Removed from this workspace', { description: row.email })
          close()
        },
        onError: report("Couldn't remove member"),
      }
    )
  }

  const secondaryActions: ChipModalFooterSlotAction[] = isRemovable
    ? [
        {
          label: row.kind === 'invite' ? 'Revoke access' : 'Remove from workspace',
          variant: 'destructive',
          onClick: handleRemove,
          disabled: isRemoving,
        },
      ]
    : []

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Manage access'
      size='sm'
      dismissDisabled={isSaving || isRemoving}
    >
      <ChipModalHeader onClose={close}>Manage access</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='copy' title='Email' value={row.email} copyLabel='Copy email' />
        <ChipModalField
          type='dropdown'
          title='Access'
          value={access}
          onChange={handleAccessChange}
          options={ACCESS_OPTIONS}
          disabled={isLocked || isSaving}
          hint={lockReason ?? undefined}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={isSaving || isRemoving}
        primaryAction={{
          label: isSaving ? 'Saving...' : 'Save',
          onClick: handleSave,
          disabled: isLocked || access === row.access.permission || isSaving,
        }}
        secondaryActions={secondaryActions}
      />
    </ChipModal>
  )
}
