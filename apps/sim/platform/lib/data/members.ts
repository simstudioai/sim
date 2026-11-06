'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/client'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { useOrganization } from '@/lib/organizations/provider'
import {
  useRemoveWorkspaceMember,
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
import {
  toRosterModel,
  toSeatsModel,
  type WorkspacePermission,
} from '@/platform/lib/data/members-model'
import type { PlatformOrganization } from '@/platform/lib/data/organization'
import { useBrowserTimezone } from '@/platform/lib/data/preferences'
import { reportFailure } from '@/platform/lib/notices'

/** Shows a failed background mutation: the row controls have no dialog of their own to hold it. */
async function reportingFailure(work: Promise<unknown>, message: string): Promise<void> {
  try {
    await work
  } catch (error) {
    reportFailure(message, error)
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
      status: seats.data ? ('success' as const) : seats.status,
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
        reportingFailure(
          updateRole.mutateAsync({ orgId: organizationId, userId, role: next }),
          "Couldn't change the role"
        ),
      changeInvitationRole: (invitationId: string, next: 'admin' | 'member') =>
        reportingFailure(
          updateInvitation.mutateAsync({ orgId: organizationId, invitationId, role: next }),
          "Couldn't change the invitation"
        ),
      changeInvitationPermission: (
        invitationId: string,
        workspaceId: string,
        permission: WorkspacePermission
      ) =>
        reportingFailure(
          updateInvitation.mutateAsync({
            orgId: organizationId,
            invitationId,
            grants: [{ workspaceId, permission }],
          }),
          "Couldn't change the invitation"
        ),
      changePermission: (userId: string, workspaceId: string, permissions: WorkspacePermission) =>
        reportingFailure(
          updatePermissions.mutateAsync({
            workspaceId,
            organizationId,
            updates: [{ userId, permissions }],
          }),
          "Couldn't change workspace access"
        ),
      removeFromWorkspace: (userId: string, workspaceId: string) =>
        reportingFailure(
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
        reportingFailure(
          cancelInvitation.mutateAsync({ invitationId, orgId: organizationId }),
          "Couldn't revoke the invite"
        ),
    },
  }
}

export type MembersActions = ReturnType<typeof useMembers>['actions']

function leaveOrganization() {
  window.location.assign(APP_ENTRY_PATH)
}

/**
 * The disclosure a removal needs and the removal itself. `checking` holds the confirm through any
 * refetch so the admin never consents to a stale list; a failed check cautions and still allows it.
 */
export function useMemberRemoval(target: { userId: string; isSelf: boolean } | null) {
  const organization = useOrganization()
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
      if (target.isSelf) leaveOrganization()
    },
  }
}

export function useOwnershipTransfer() {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const transfer = useTransferOwnership()
  const portal = useOpenBillingPortal()
  const [portalError, setPortalError] = useState<string | null>(null)
  return {
    portalDisabled: portal.isPending,
    portalPending: portal.isPending,
    portalError,
    /** The hook's default stays on the organization; this surface only offers hand-off and leave. */
    confirm: async (newOwnerUserId: string) => {
      const result = await transfer.mutateAsync({
        orgId: organizationId,
        newOwnerUserId,
        alsoLeave: true,
      })
      if (result.left) leaveOrganization()
      else if (result.warning) toast.warning(`Ownership transferred. ${result.warning}`)
    },
    openBillingPortal: () => {
      setPortalError(null)
      portal.open(
        {
          context: 'organization',
          organizationId,
          returnUrl: `${window.location.origin}${APP_ENTRY_PATH}`,
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
