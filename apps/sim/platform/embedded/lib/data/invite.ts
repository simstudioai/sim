'use client'

import { useSession } from '@/lib/auth/client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { buildInviteFailureMessage } from '@/lib/invitations/error-messages'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useOrganization } from '@/lib/organizations/provider'
import { toast } from '@/lib/toast/sink'
import { useSendWorkspaceInvitations } from '@/hooks/queries/invitations'
import { useOrganizationPlanSeats } from '@/hooks/queries/organization-plan-seats'
import { plural } from '@/platform/shared/plural'

export const ORGANIZATION_ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

const SEAT_WARNING =
  'invites beyond that may fail. External collaborators and existing members do not use seats.'

/**
 * Inviting people to the organization, offered only to a viewer who may, which implies an admin. The
 * seat warning is advisory: the server decides per address, since an existing member or an external
 * collaborator takes no seat, and reports each failure back.
 */
export function useInviteMembers() {
  const { organization, deployment } = useOrganization()
  const { data: session } = useSession()
  const seats = useOrganizationPlanSeats(organization.id, { enabled: deployment.billingEnabled })
  const send = useSendWorkspaceInvitations()
  const viewerEmail = session?.user?.email?.toLowerCase()
  const seatData = seats.data?.data
  const available = seatData ? Math.max(0, seatData.totalSeats - seatData.usedSeats) : 0
  const seatCapped = Boolean(
    seatData && isEnterprise(seatData.subscriptionPlan) && seatData.totalSeats > 0
  )
  return {
    addressProblem: (address: string): string | null => {
      const format = quickValidateEmail(address)
      if (!format.isValid) return format.reason ?? 'Invalid email'
      return address.toLowerCase() === viewerEmail ? 'You cannot invite yourself' : null
    },
    seatWarning: (count: number): string | undefined =>
      seatCapped && count > available
        ? `Only ${plural(available, 'seat')} available — ${SEAT_WARNING}`
        : undefined,
    /** Resolves with the addresses to keep, and the reasons when any of them failed. */
    submit: async (emails: string[], membership: 'member' | 'admin') => {
      const result = await send.mutateAsync({
        workspaceIds: [],
        emails,
        permission: 'write',
        membership,
        organizationId: organization.id,
      })
      const sent = [
        result.added.length > 0 && `${plural(result.added.length, 'member')} added`,
        result.successful.length > 0 && `${plural(result.successful.length, 'invite')} sent`,
      ].filter(Boolean)
      if (sent.length > 0) toast.success(sent.join(' · '))
      return {
        failed: result.failed.map((failure) => failure.email),
        message: result.failed.length
          ? buildInviteFailureMessage(result.failed, emails.length)
          : null,
      }
    },
  }
}
