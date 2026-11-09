'use client'

import { useState } from 'react'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import type { OrganizationRoster } from '@/lib/api/contracts/organization'
import { useSession } from '@/lib/auth/client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { buildInviteFailureMessage } from '@/lib/invitations/error-messages'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import {
  useRemoveWorkspaceMember,
  useSendWorkspaceInvitations,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
import {
  useCancelInvitation,
  useMemberRemovalImpact,
  useOrganizationMemberUsageLimit,
  useOrganizationRoster,
  useRemoveMember,
  useResendInvitation,
  useTransferOwnership,
  useUpdateInvitation,
  useUpdateOrganizationMemberRole,
  useUpdateOrganizationMemberUsageLimit,
} from '@/hooks/queries/organization'
import { useOrganizationPlanSeats } from '@/hooks/queries/organization-plan-seats'
import { useOpenBillingPortal } from '@/hooks/queries/subscription'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useOrganization } from '@/platform/lib/data/organization'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { useFixtureSettings } from '@/platform/lib/data/settings-providers'
import { platformHref } from '@/platform/lib/navigation'
import { toRosterModel, toSeatsModel, type WorkspacePermission } from '@/platform/shared/members'
import { plural } from '@/platform/shared/plural'
import { useBrowserTimezone } from '@/platform/shared/preferences'

export type SettingsRoster = OrganizationRoster

/** Shows a failed background mutation: the row controls have no dialog of their own to hold it. */
async function reportFailure(work: Promise<unknown>, message: string): Promise<void> {
  try {
    await work
  } catch (error) {
    toast.error(message, { description: getErrorMessage(error, 'Please try again in a moment.') })
  }
}

/**
 * The viewer's standing and the roster's rows. The role comes from the viewer's own roster row and
 * falls back to the server-read surface; Better Auth's organization read caps its member list and
 * can omit or lag the caller, so it is never consulted.
 */
export function useMembers(organization: PlatformOrganization) {
  const organizationId = organization.organization.id
  const { hosted, billingEnabled } = organization.deployment
  const { data: session } = useSession()
  const viewerId = session?.user?.id
  const roster = useOrganizationRoster(organizationId)
  const timeZone = useBrowserTimezone()
  const role =
    roster.data?.members.find((member) => member.userId === viewerId)?.role ??
    organization.viewer.role
  const canManage = isOrgAdminRole(role)
  const seats = useOrganizationPlanSeats(organizationId, { enabled: billingEnabled && canManage })
  const updateRole = useUpdateOrganizationMemberRole()
  const updateInvitation = useUpdateInvitation()
  const updatePermissions = useUpdateWorkspacePermissions()
  const removeFromWorkspace = useRemoveWorkspaceMember()
  const cancelInvitation = useCancelInvitation()
  const resendInvitation = useResendInvitation()

  return {
    viewerId,
    canManage,
    canLeave: Boolean(viewerId) && role !== 'owner',
    canInvite: canManage && organization.viewer.canInviteMembers,
    roster: {
      status: roster.status,
      model: roster.data
        ? toRosterModel(roster.data, { userId: viewerId, canManage, hosted, timeZone })
        : undefined,
      error: roster.error,
      retrying: roster.isFetching,
      retry: () => void roster.refetch(),
    },
    seats: {
      visible: billingEnabled && canManage,
      status: seats.status,
      model: seats.data ? toSeatsModel(seats.data.data) : undefined,
      hasPaidSubscription: Boolean(seats.data?.data.subscriptionPlan),
      error: seats.error,
      retrying: seats.isFetching,
      retry: () => void seats.refetch(),
    },
    actions: {
      rolePending: updateRole.isPending,
      invitationPending: updateInvitation.isPending,
      permissionPending: updatePermissions.isPending,
      changeRole: (userId: string, next: 'admin' | 'member') =>
        reportFailure(
          updateRole.mutateAsync({ orgId: organizationId, userId, role: next }),
          "Couldn't change the role"
        ),
      changeInvitationRole: (invitationId: string, next: 'admin' | 'member') =>
        reportFailure(
          updateInvitation.mutateAsync({ orgId: organizationId, invitationId, role: next }),
          "Couldn't change the invitation"
        ),
      changeInvitationPermission: (
        invitationId: string,
        workspaceId: string,
        permission: WorkspacePermission
      ) =>
        reportFailure(
          updateInvitation.mutateAsync({
            orgId: organizationId,
            invitationId,
            grants: [{ workspaceId, permission }],
          }),
          "Couldn't change the invitation"
        ),
      changePermission: (userId: string, workspaceId: string, permissions: WorkspacePermission) =>
        reportFailure(
          updatePermissions.mutateAsync({
            workspaceId,
            organizationId,
            updates: [{ userId, permissions }],
          }),
          "Couldn't change workspace access"
        ),
      removeFromWorkspace: (userId: string, workspaceId: string) =>
        reportFailure(
          removeFromWorkspace.mutateAsync({ userId, workspaceId, organizationId }),
          "Couldn't remove member"
        ),
      resendInvitation: async (invitationId: string) => {
        try {
          await resendInvitation.mutateAsync({ invitationId, orgId: organizationId })
          toast.success('Invite sent')
        } catch (error) {
          toast.error("Couldn't resend the invite", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          })
        }
      },
      revokeInvitation: (invitationId: string) =>
        reportFailure(
          cancelInvitation.mutateAsync({ invitationId, orgId: organizationId }),
          "Couldn't revoke the invite"
        ),
    },
  }
}

export type MembersActions = ReturnType<typeof useMembers>['actions']

export function useMemberSearch() {
  const [search, setSearch] = useQueryState('search', {
    defaultValue: '',
    history: 'replace',
    clearOnDefault: true,
  })
  const write = useDebouncedSearchSetter((value, options) => setSearch(value, options))
  return { search, setSearch: write }
}

function useLeaveOrganization(organization: PlatformOrganization) {
  const fixture = useFixtureSettings()
  const router = useRouter()
  const search = useSearchParams()
  return () => {
    if (fixture) router.replace(platformHref('/home', search))
    else window.location.assign(`${organization.legacyOrigin}${APP_ENTRY_PATH}`)
  }
}

/**
 * The disclosure a removal needs and the removal itself. `checking` holds the confirm through any
 * refetch so the admin never consents to a stale list; a failed check cautions and still allows it.
 */
export function useMemberRemoval(target: { userId: string; isSelf: boolean } | null) {
  const organization = useOrganization()
  const leave = useLeaveOrganization(organization)
  const organizationId = organization.organization.id
  const impact = useMemberRemovalImpact(organizationId, target?.userId, {
    enabled: target !== null,
  })
  const remove = useRemoveMember()
  return {
    credentials: [...new Set(impact.data?.map((credential) => credential.displayName) ?? [])],
    checking: impact.isFetching,
    checkFailed: impact.isError,
    confirm: async () => {
      if (!target) return
      await remove.mutateAsync({ memberId: target.userId, orgId: organizationId })
      if (target.isSelf) leave()
    },
  }
}

export function useOwnershipTransfer() {
  const organization = useOrganization()
  const leave = useLeaveOrganization(organization)
  const fixture = useFixtureSettings()
  const organizationId = organization.organization.id
  const transfer = useTransferOwnership()
  const portal = useOpenBillingPortal()
  const [portalError, setPortalError] = useState<string | null>(null)
  return {
    portalDisabled: fixture || portal.isPending,
    portalPending: portal.isPending,
    portalError,
    /** The hook's default stays on the organization; this surface only offers hand-off and leave. */
    confirm: async (newOwnerUserId: string) => {
      const result = await transfer.mutateAsync({
        orgId: organizationId,
        newOwnerUserId,
        alsoLeave: true,
      })
      if (result.left) leave()
      else if (result.warning) toast.warning(`Ownership transferred. ${result.warning}`)
    },
    openBillingPortal: () => {
      if (fixture || portal.isPending) return
      setPortalError(null)
      portal.open(
        {
          context: 'organization',
          organizationId,
          returnUrl: `${organization.legacyOrigin}${APP_ENTRY_PATH}`,
        },
        (error) =>
          setPortalError(
            getErrorMessage(error, 'Failed to open Stripe billing portal. Please try again.')
          )
      )
    },
  }
}

/** A member's credit cap. Hosted only: only hosted deployments enforce it. */
export function useMemberCredits(userId: string) {
  const organizationId = useOrganization().organization.id
  const limit = useOrganizationMemberUsageLimit(organizationId, userId)
  const update = useUpdateOrganizationMemberUsageLimit()
  return {
    loading: limit.isLoading,
    error: limit.error,
    retry: () => void limit.refetch(),
    usage: limit.data,
    save: async (creditLimit: number | null) => {
      await update.mutateAsync({ orgId: organizationId, userId, creditLimit })
    },
  }
}

const SEAT_WARNING =
  'invites beyond that may fail. External collaborators and existing members do not use seats.'

/**
 * Sending invitations from any entry on this surface. The seat warning is advisory by design: the
 * server decides per email, and an existing member or an invitee forced external takes no seat.
 */
export function useInviteMembers(open: boolean) {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const { billingEnabled } = organization.deployment
  const { isAdmin, canInviteMembers } = organization.viewer
  const { data: session } = useSession()
  const seats = useOrganizationPlanSeats(organizationId, {
    enabled: open && billingEnabled && isAdmin,
  })
  const send = useSendWorkspaceInvitations()
  const viewerEmail = session?.user?.email?.toLowerCase()
  const seatData = seats.data?.data
  const available = seatData ? Math.max(0, seatData.totalSeats - seatData.usedSeats) : 0
  const seatCapped = Boolean(
    isAdmin && seatData && isEnterprise(seatData.subscriptionPlan) && seatData.totalSeats > 0
  )
  return {
    canInvite: canInviteMembers && isAdmin,
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
        organizationId,
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
