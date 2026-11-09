'use client'

import { useState } from 'react'
import { SelectField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { toast } from '@/lib/toast/sink'
import {
  buildInviteFailureMessage,
  isEnterprise,
  quickValidateEmail,
  useAdminWorkspaces,
  useDeploymentShape,
  useOrganizationPlanSeats,
  useSendWorkspaceInvitations,
  useSession,
  type WorkspacePermission,
} from '@/platform/lib/data/teammates'
import { plural } from '@/platform/shared/plural'

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

const EXTERNAL_HINT =
  'Access to the selected workspaces only — no seat. Only available for people already on a paid Sim plan.'

interface Recipient {
  address: string
  invalid?: boolean
}

interface InviteTeammatesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceName: string
  /** The organization the invite is scoped to; null for a personal workspace. */
  organizationId: string | null
  /** Set when the plan or policy blocks invites for this workspace. */
  inviteDisabledReason: string | null
  /** Whether the viewer administers the organization that hosts this workspace. */
  isOrganizationAdmin: boolean
}

/**
 * Invites people to this workspace and, in an organization, to its other workspaces the viewer
 * administers, with what they become in the organization. Failed addresses stay with their reasons
 * so a retry resends only those; the seat warning never blocks, because the server decides per
 * address.
 */
export function InviteTeammatesModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  organizationId,
  inviteDisabledReason,
  isOrganizationAdmin,
}: InviteTeammatesModalProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([workspaceId])
  const [access, setAccess] = useState<WorkspacePermission>('write')
  const [membership, setMembership] = useState<Membership>('member')
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setRecipients([])
      setWorkspaceIds([workspaceId])
      setAccess('write')
      setMembership('member')
    }
  }

  const { data: session } = useSession()
  const { billingEnabled } = useDeploymentShape()
  const send = useSendWorkspaceInvitations()
  const isOrganizationInvite = organizationId !== null
  const adminWorkspaces = useAdminWorkspaces(session?.user?.id, organizationId ?? undefined, {
    enabled: open && isOrganizationInvite,
  })
  const workspaceOptions = isOrganizationInvite
    ? (adminWorkspaces.data ?? [])
        .filter((workspace) => workspace.canInvite || workspace.id === workspaceId)
        .map((workspace) => ({ value: workspace.id, label: workspace.name }))
    : [{ value: workspaceId, label: workspaceName }]

  /** Organization admin is an organization-level grant, offered only by someone who holds it. */
  const canGrantOrganizationAdmin = isOrganizationInvite && isOrganizationAdmin
  const membershipOptions = MEMBERSHIP_OPTIONS.filter(
    (option) => option.value !== 'admin' || canGrantOrganizationAdmin
  )

  const seats = useOrganizationPlanSeats(organizationId ?? '', {
    enabled: open && billingEnabled && canGrantOrganizationAdmin,
  })
  const seatData = seats.data?.data
  const availableSeats = seatData ? Math.max(0, seatData.totalSeats - seatData.usedSeats) : 0
  /** Only Enterprise has a fixed seat cap; Team seats are provisioned as invitees accept. */
  const seatCapped = Boolean(
    canGrantOrganizationAdmin &&
      seatData &&
      isEnterprise(seatData.subscriptionPlan) &&
      seatData.totalSeats > 0
  )
  const seatWarning =
    seatCapped && membership !== 'external' && recipients.length > availableSeats
      ? `Only ${plural(availableSeats, 'seat')} available — invites beyond that may fail. External collaborators and existing members do not use seats.`
      : undefined

  const viewerEmail = session?.user?.email?.toLowerCase()
  const addressProblem = (address: string): string | null => {
    const format = quickValidateEmail(address)
    if (!format.isValid) return format.reason ?? 'Invalid email'
    return address.toLowerCase() === viewerEmail ? 'You cannot invite yourself' : null
  }
  const problem = recipients
    .filter((recipient) => recipient.invalid)
    .map((recipient) => addressProblem(recipient.address))
    .find(Boolean)
  const blocked = Boolean(inviteDisabledReason)

  return (
    <Modal
      title='Invite teammates'
      accessibleName={`Invite teammates to ${workspaceName}`}
      open={open}
      onOpenChange={onOpenChange}
      confirmLabel='Send invites'
      confirmDisabled={
        blocked || recipients.length === 0 || workspaceIds.length === 0 || Boolean(problem)
      }
      onConfirm={async () => {
        const emails = recipients.map(({ address }) => address)
        const result = await send.mutateAsync({
          workspaceIds,
          emails,
          permission: access,
          membership: isOrganizationInvite ? membership : undefined,
          organizationId,
        })
        const sent = [
          result.added.length > 0 && `${plural(result.added.length, 'member')} added`,
          result.successful.length > 0 && `${plural(result.successful.length, 'invite')} sent`,
        ].filter(Boolean)
        if (sent.length > 0) toast.success(sent.join(' · '))
        if (result.failed.length > 0) {
          setRecipients(result.failed.map((failure) => ({ address: failure.email })))
          throw new Error(buildInviteFailureMessage(result.failed, emails.length))
        }
      }}
    >
      <RecipientField
        label='Emails'
        placeholder='Enter emails'
        recipients={recipients}
        onRecipientsChange={setRecipients}
        validate={(address) => addressProblem(address) === null}
        error={problem ?? undefined}
        hint={inviteDisabledReason ?? seatWarning}
        disabled={blocked}
      />
      <MultiSelect
        label='Workspaces'
        options={workspaceOptions}
        value={workspaceIds}
        onValueChange={setWorkspaceIds}
        placeholder='Select workspaces'
        searchLabel='Search workspaces'
        disabled={blocked || workspaceOptions.length <= 1}
      />
      <SelectField
        label='Workspace access'
        options={ACCESS_OPTIONS}
        value={access}
        onValueChange={setAccess}
        disabled={blocked}
      />
      {isOrganizationInvite && (
        <SelectField
          label='Organization membership'
          options={membershipOptions}
          value={membership}
          onValueChange={setMembership}
          hint={membership === 'external' ? EXTERNAL_HINT : undefined}
          disabled={blocked}
        />
      )}
    </Modal>
  )
}
