'use client'

import { useCallback, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useBatchSendWorkspaceInvitations } from '@/hooks/queries/invitations'
import { useOrganizationBilling } from '@/hooks/queries/organization'

const logger = createLogger('InviteModal')

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'write', label: 'Write' },
  { value: 'read', label: 'Read' },
] as const

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName?: string
  inviteDisabledReason?: string | null
  organizationId?: string | null
}

export function InviteModal({
  open,
  onOpenChange,
  workspaceName,
  inviteDisabledReason = null,
  organizationId = null,
}: InviteModalProps) {
  const [emails, setEmails] = useState<string[]>([])
  const [inviteRole, setInviteRole] = useState<PermissionType>('admin')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { workspacePermissions, userPermissions: userPerms } = useWorkspacePermissionsContext()
  const canViewOrganizationBilling =
    Boolean(organizationId) &&
    hostContext.hostOrganizationId === organizationId &&
    hostContext.viewer.isHostOrganizationAdmin

  const { data: organizationBillingData } = useOrganizationBilling(organizationId ?? '', {
    enabled: open && isBillingEnabled && canViewOrganizationBilling,
  })

  const batchSendInvitations = useBatchSendWorkspaceInvitations()

  const canInviteMembers = userPerms.canAdmin && !inviteDisabledReason
  const isSubmitting = batchSendInvitations.isPending

  const totalSeats = organizationBillingData?.data?.totalSeats ?? 0
  const usedSeats = organizationBillingData?.data?.usedSeats ?? 0
  const availableSeats = Math.max(0, totalSeats - usedSeats)
  // Only Enterprise plans have a fixed seat cap that gates invites. Team/Pro
  // seats are provisioned automatically when an invitee accepts.
  const isEnterpriseOrg = isEnterprise(organizationBillingData?.data?.subscriptionPlan)
  const hasSeatData = canViewOrganizationBilling && isEnterpriseOrg && totalSeats > 0
  const exceedsSeatCapacity = hasSeatData && userPerms.canAdmin && emails.length > availableSeats
  const seatLimitReason = exceedsSeatCapacity
    ? `Only ${availableSeats} internal seat${availableSeats === 1 ? '' : 's'} available. External workspace invites do not require seats.`
    : null

  const validateEmail = useCallback(
    (email: string): string | null => {
      const formatResult = quickValidateEmail(email)
      if (!formatResult.isValid) {
        return formatResult.reason ?? 'Invalid email'
      }
      if (workspacePermissions?.users?.some((user) => user.email === email)) {
        return `${email} is already a teammate in this workspace`
      }
      if (session?.user?.email && session.user.email.toLowerCase() === email) {
        return 'You cannot invite yourself'
      }
      return null
    },
    [workspacePermissions?.users, session?.user?.email]
  )

  const handleEmailsChange = useCallback((next: string[]) => {
    setEmails(next)
    setErrorMessage(null)
  }, [])

  const handleSendInvites = useCallback(() => {
    setErrorMessage(null)
    if (!canInviteMembers || emails.length === 0 || !workspaceId) return

    const invitations = emails.map((email) => ({ email, permission: inviteRole }))

    batchSendInvitations.mutate(
      { workspaceId, organizationId, invitations },
      {
        onSuccess: (result) => {
          const parts: string[] = []
          if (result.added.length > 0) {
            parts.push(`${result.added.length} member${result.added.length === 1 ? '' : 's'} added`)
          }
          if (result.successful.length > 0) {
            parts.push(
              `${result.successful.length} invite${result.successful.length === 1 ? '' : 's'} sent`
            )
          }
          if (parts.length > 0) {
            toast.success(parts.join(' · '))
          }

          if (result.failed.length > 0) {
            // Keep the failed addresses in the field with the error for retry.
            setEmails(result.failed.map((f) => f.email))
            setErrorMessage(
              result.failed.length === 1
                ? result.failed[0].error
                : `${result.failed.length} invitations failed. ${result.failed[0].error}`
            )
            return
          }

          setEmails([])
          onOpenChange(false)
        },
        onError: (error) => {
          logger.error('Error inviting teammates:', error)
          setErrorMessage(error.message || 'An unexpected error occurred. Please try again.')
        },
      }
    )
  }, [
    canInviteMembers,
    emails,
    workspaceId,
    organizationId,
    inviteRole,
    batchSendInvitations,
    onOpenChange,
  ])

  const resetState = useCallback(() => {
    setEmails([])
    setInviteRole('admin')
    setErrorMessage(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetState()
      onOpenChange(next)
    },
    [onOpenChange, resetState]
  )

  const isSendDisabled =
    !canInviteMembers || isSubmitting || !workspaceId || emails.length === 0 || exceedsSeatCapacity

  const fieldHint = inviteDisabledReason ?? seatLimitReason

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      srTitle={`Invite teammates to ${workspaceName || 'workspace'}`}
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>Invite teammates</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title='Emails'
          value={emails}
          onChange={handleEmailsChange}
          validate={validateEmail}
          error={errorMessage}
          hint={fieldHint}
          placeholder={
            !canInviteMembers
              ? inviteDisabledReason || 'Only administrators can invite new teammates'
              : 'Enter emails'
          }
          disabled={isSubmitting || !canInviteMembers}
        />
        <ChipModalField
          type='dropdown'
          title='Invite as'
          options={ROLE_OPTIONS}
          value={inviteRole}
          placeholder='Select role'
          align='start'
          onChange={(role) => setInviteRole(role as PermissionType)}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label: isSubmitting ? 'Sending...' : 'Send invites',
          onClick: handleSendInvites,
          disabled: isSendDisabled,
        }}
      />
    </ChipModal>
  )
}
