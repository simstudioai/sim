'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ChipDropdown,
  type ChipDropdownOption,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useSession } from '@/lib/auth/auth-client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useSendWorkspaceInvitations } from '@/hooks/queries/invitations'
import { useOrganizationBilling } from '@/hooks/queries/organization'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'

const logger = createLogger('InviteModal')

const ACCESS_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'write', label: 'Write' },
  { value: 'read', label: 'Read' },
] as const

const MEMBERSHIP_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'external', label: 'External' },
] as const

type Membership = (typeof MEMBERSHIP_OPTIONS)[number]['value']

const MEMBERSHIP_HINTS: Record<Membership, string> = {
  member: 'Joins your organization. Adds a seat.',
  admin: 'Joins your organization and can manage it. Adds a seat.',
  external:
    'Access to the selected workspaces only — no seat. Only available for people already on a paid Sim plan.',
}

const EMPTY_WORKSPACE_IDS: string[] = []

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Workspace the invite starts from. Pre-selected on open, and the only
   * option outside an organization — personal workspaces are invited to one at
   * a time. Omit when inviting from organization settings, where no single
   * workspace is in context.
   */
  workspaceId?: string
  workspaceName?: string
  /** Organization the invite is scoped to; null for a personal workspace. */
  organizationId?: string | null
  /** Set when the plan or policy blocks invites for this workspace. */
  inviteDisabledReason?: string | null
  /** False when the viewer lacks permission to invite. */
  canInvite?: boolean
}

/**
 * The single invite surface: pick people, pick the workspaces to give them,
 * pick what they become in the organization. Every entry point renders this,
 * so an invite means the same thing wherever it is sent from.
 */
export function InviteModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  organizationId = null,
  inviteDisabledReason = null,
  canInvite = true,
}: InviteModalProps) {
  const [emails, setEmails] = useState<string[]>([])
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>(
    workspaceId ? [workspaceId] : EMPTY_WORKSPACE_IDS
  )
  const [access, setAccess] = useState<PermissionType>('write')
  const [membership, setMembership] = useState<Membership>('member')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /**
   * Seed a fresh invite each time the modal opens, so a re-open never inherits
   * the previous attempt and the pre-selected workspace tracks the one the
   * viewer is actually in.
   */
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setEmails([])
      setSelectedWorkspaceIds(workspaceId ? [workspaceId] : EMPTY_WORKSPACE_IDS)
      setAccess('write')
      setMembership('member')
      setErrorMessage(null)
    }
  }

  const { data: session } = useSession()
  const isOrganizationInvite = Boolean(organizationId)

  const sendInvitations = useSendWorkspaceInvitations()
  const isSubmitting = sendInvitations.isPending

  /**
   * Only organization invites offer a choice of workspaces: a personal
   * workspace has no siblings an invite can span.
   */
  const { data: adminWorkspaces } = useAdminWorkspaces(
    session?.user?.id,
    organizationId ?? undefined,
    { enabled: open && isOrganizationInvite }
  )

  const workspaceOptions = useMemo<ChipDropdownOption[]>(() => {
    if (!isOrganizationInvite) {
      return workspaceId ? [{ value: workspaceId, label: workspaceName ?? 'This workspace' }] : []
    }
    return (adminWorkspaces ?? [])
      .filter((workspace) => workspace.canInvite || workspace.id === workspaceId)
      .map((workspace) => ({ value: workspace.id, label: workspace.name }))
  }, [isOrganizationInvite, adminWorkspaces, workspaceId, workspaceName])

  /**
   * Seat data is organization-admin-only, and the prop can lag the route, so
   * it is fetched solely when the viewer administers the organization the page
   * is actually hosted by.
   */
  const hostContext = useWorkspaceHostContext()
  /**
   * Organization Admin is an organization-level grant — it carries admin on every
   * workspace the org owns plus member and billing management — so it is only
   * offered to someone who already holds it. The batch endpoint enforces the same
   * rule; this only keeps the UI from presenting an option that would be refused.
   */
  const canGrantOrganizationAdmin =
    isOrganizationInvite &&
    hostContext.hostOrganizationId === organizationId &&
    hostContext.viewer.isHostOrganizationAdmin
  const membershipOptions = canGrantOrganizationAdmin
    ? MEMBERSHIP_OPTIONS
    : MEMBERSHIP_OPTIONS.filter((option) => option.value !== 'admin')
  const canViewOrganizationBilling =
    isOrganizationInvite &&
    hostContext.hostOrganizationId === organizationId &&
    hostContext.viewer.isHostOrganizationAdmin

  const { data: organizationBillingData } = useOrganizationBilling(organizationId ?? '', {
    enabled: open && isBillingEnabled && canViewOrganizationBilling,
  })

  const totalSeats = organizationBillingData?.data?.totalSeats ?? 0
  const usedSeats = organizationBillingData?.data?.usedSeats ?? 0
  const availableSeats = Math.max(0, totalSeats - usedSeats)
  /**
   * Only Enterprise plans have a fixed seat cap that gates invites. Team seats
   * are provisioned when an invitee accepts, and externals never take one.
   */
  const isEnterpriseOrg = isEnterprise(organizationBillingData?.data?.subscriptionPlan)
  const hasSeatData = canViewOrganizationBilling && isEnterpriseOrg && totalSeats > 0
  /**
   * Advisory only. The server decides per email and does not charge a seat for
   * everyone: an existing organization member is granted access directly, and an
   * invitee who already belongs to another organization is forced external. A
   * hard block here refused batches the API would have accepted, so this warns
   * and lets the send proceed — per-email failures come back with reasons.
   */
  const mayExceedSeatCapacity =
    hasSeatData && membership !== 'external' && emails.length > availableSeats
  const seatLimitReason = mayExceedSeatCapacity
    ? `Only ${availableSeats} seat${availableSeats === 1 ? '' : 's'} available — invites beyond that may fail. External collaborators and existing members do not use seats.`
    : null

  const validateEmail = useCallback(
    (email: string): string | null => {
      const formatResult = quickValidateEmail(email)
      if (!formatResult.isValid) {
        return formatResult.reason ?? 'Invalid email'
      }
      if (session?.user?.email && session.user.email.toLowerCase() === email) {
        return 'You cannot invite yourself'
      }
      return null
    },
    [session?.user?.email]
  )

  const handleEmailsChange = useCallback((next: string[]) => {
    setEmails(next)
    setErrorMessage(null)
  }, [])

  const handleSend = useCallback(() => {
    setErrorMessage(null)
    if (emails.length === 0 || selectedWorkspaceIds.length === 0) return

    sendInvitations.mutate(
      {
        workspaceIds: selectedWorkspaceIds,
        emails,
        permission: access,
        membership: isOrganizationInvite ? membership : undefined,
        organizationId,
      },
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
            // Keep the failed addresses in the field, with the reason, for retry.
            setEmails(result.failed.map((failure) => failure.email))
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
          logger.error('Failed to invite teammates', { error })
          setErrorMessage(error.message || 'An unexpected error occurred. Please try again.')
        },
      }
    )
  }, [
    emails,
    selectedWorkspaceIds,
    access,
    membership,
    isOrganizationInvite,
    organizationId,
    onOpenChange,
  ])

  const isSendDisabled =
    !canInvite ||
    Boolean(inviteDisabledReason) ||
    isSubmitting ||
    emails.length === 0 ||
    selectedWorkspaceIds.length === 0

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Invite teammates to ${workspaceName || 'workspace'}`}
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>Invite teammates</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title='Emails'
          value={emails}
          onChange={handleEmailsChange}
          validate={validateEmail}
          hint={inviteDisabledReason ?? seatLimitReason}
          placeholder={
            canInvite
              ? 'Enter emails'
              : inviteDisabledReason || 'Only administrators can invite new teammates'
          }
          disabled={isSubmitting || !canInvite}
        />
        <ChipModalField type='custom' title='Workspaces'>
          <ChipDropdown
            multiple
            value={selectedWorkspaceIds}
            onChange={setSelectedWorkspaceIds}
            options={workspaceOptions}
            allLabel='Select workspaces'
            showAllOption={false}
            searchable={isOrganizationInvite}
            searchPlaceholder='Search workspaces...'
            fullWidth
            flush
            disabled={isSubmitting || !canInvite || workspaceOptions.length <= 1}
          />
        </ChipModalField>
        <ChipModalField
          type='dropdown'
          title='Workspace access'
          options={ACCESS_OPTIONS}
          value={access}
          placeholder='Select access'
          align='start'
          disabled={isSubmitting || !canInvite}
          onChange={(next) => setAccess(next as PermissionType)}
        />
        {isOrganizationInvite && (
          <ChipModalField
            type='dropdown'
            title='Membership'
            options={membershipOptions}
            value={membership}
            placeholder='Select membership'
            align='start'
            hint={MEMBERSHIP_HINTS[membership]}
            disabled={isSubmitting || !canInvite}
            onChange={(next) => setMembership(next as Membership)}
          />
        )}
        <ChipModalError>{errorMessage}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label: isSubmitting ? 'Sending...' : 'Send invites',
          onClick: handleSend,
          disabled: isSendDisabled,
        }}
      />
    </ChipModal>
  )
}
