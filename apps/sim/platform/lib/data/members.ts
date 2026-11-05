'use client'

import { useState } from 'react'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useQueryState } from 'nuqs'
import type {
  OrganizationRoster,
  RosterMember,
  RosterPendingInvitation,
  RosterWorkspaceAccess,
} from '@/lib/api/contracts/organization'
import { useSession } from '@/lib/auth/client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { buildInviteFailureMessage } from '@/lib/invitations/failure-message'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { workspaceRoleLockReason } from '@/lib/workspaces/permissions/role-lock'
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
import { toast } from '@/platform/lib/data/toast'

type OrganizationRole = RosterMember['role']
export type WorkspacePermission = RosterWorkspaceAccess['permission']

export interface MemberRowModel {
  key: string
  /** The path parameter of `DELETE members/[memberId]`, whatever that parameter's name suggests. */
  userId: string
  name: string
  email: string
  image?: string
  role: OrganizationRole
  /** "Joined ..." or the directory deactivation. */
  status: string
  isSelf: boolean
  isOwner: boolean
  canEditRole: boolean
  canRemove: boolean
  canManageCredits: boolean
  canTransfer: boolean
}

export interface InvitationRowModel {
  key: string
  id: string
  name: string
  email: string
  image?: string
  role: 'admin' | 'member'
  isExternal: boolean
}

export interface WorkspaceMemberRowModel extends MemberRowModel {
  permission: WorkspacePermission
  /** Why the server would refuse a permission edit; shown beside the disabled control. */
  lockReason: string | null
  canEditPermission: boolean
  canRemoveFromWorkspace: boolean
}

export interface WorkspaceInvitationRowModel extends InvitationRowModel {
  permission: WorkspacePermission
}

interface WorkspaceGroupModel {
  id: string
  name: string
  total: number
  members: WorkspaceMemberRowModel[]
  invitations: WorkspaceInvitationRowModel[]
}

export interface RosterModel {
  /** Everyone in the organization section before any filter. */
  total: number
  members: MemberRowModel[]
  invitations: InvitationRowModel[]
  workspaces: WorkspaceGroupModel[]
}

interface RosterViewer {
  userId: string | undefined
  canManage: boolean
  hosted: boolean
}

function joinedLabel(member: RosterMember): string {
  if (member.suspendedAt) return 'Deactivated by your directory'
  return `Joined ${formatDate(new Date(member.createdAt))}`
}

/**
 * Every predicate mirrors a server guard, so a control offered here is one the route accepts. The
 * organization-role edit, removal and workspace edits are refused for the same rows on the server.
 */
function toMemberRow(member: RosterMember, viewer: RosterViewer): MemberRowModel {
  const isSelf = member.userId === viewer.userId
  const isOwner = member.role === 'owner'
  const isExternal = member.role === 'external'
  return {
    key: member.memberId,
    userId: member.userId,
    name: member.name,
    email: member.email,
    image: member.image ?? undefined,
    role: member.role,
    status: joinedLabel(member),
    isSelf,
    isOwner,
    canEditRole: viewer.canManage && !isSelf && !isOwner && !isExternal,
    canRemove: viewer.canManage && !isSelf && !isOwner,
    // The usage-limit API answers 404 outside hosted deployments.
    canManageCredits: viewer.canManage && !isOwner && viewer.hosted,
    canTransfer: isSelf && isOwner,
  }
}

function toInvitationRow(invitation: RosterPendingInvitation): InvitationRowModel {
  return {
    key: invitation.id,
    id: invitation.id,
    name: invitation.inviteeName ?? invitation.email,
    email: invitation.email,
    image: invitation.inviteeImage ?? undefined,
    role: invitation.role === 'admin' ? 'admin' : 'member',
    isExternal: invitation.membershipIntent === 'external',
  }
}

function toWorkspaceMemberRow(
  member: RosterMember,
  access: RosterWorkspaceAccess,
  viewer: RosterViewer
): WorkspaceMemberRowModel {
  const row = toMemberRow(member, viewer)
  const lockReason = workspaceRoleLockReason(access.roleSource, {
    isBilledAccount: access.isBilledAccount,
  })
  const wouldDemoteSelf = row.isSelf && access.permission === 'admin'
  return {
    ...row,
    key: `${access.workspaceId}/${member.memberId}`,
    permission: access.permission,
    lockReason,
    canEditPermission: viewer.canManage && lockReason === null && !wouldDemoteSelf,
    canRemoveFromWorkspace:
      viewer.canManage && !isOrgAdminRole(member.role) && !row.isSelf && !access.isBilledAccount,
  }
}

function firstAccessPerWorkspace<Row>(
  rows: readonly { row: Row; workspaces: RosterWorkspaceAccess[] }[]
) {
  const byWorkspace = new Map<string, { row: Row; access: RosterWorkspaceAccess }[]>()
  for (const { row, workspaces } of rows) {
    const seen = new Set<string>()
    for (const access of workspaces) {
      if (seen.has(access.workspaceId)) continue
      seen.add(access.workspaceId)
      const entries = byWorkspace.get(access.workspaceId)
      if (entries) entries.push({ row, access })
      else byWorkspace.set(access.workspaceId, [{ row, access }])
    }
  }
  return byWorkspace
}

function toRosterModel(roster: OrganizationRoster, viewer: RosterViewer): RosterModel {
  const membersByWorkspace = firstAccessPerWorkspace(
    roster.members.map((member) => ({ row: member, workspaces: member.workspaces }))
  )
  const invitationsByWorkspace = firstAccessPerWorkspace(
    roster.pendingInvitations.map((invitation) => ({
      row: invitation,
      workspaces: invitation.workspaces,
    }))
  )
  const organizationInvitations = roster.pendingInvitations.filter(
    (invitation) => invitation.kind === 'organization'
  )
  return {
    total: roster.members.length + organizationInvitations.length,
    members: roster.members.map((member) => toMemberRow(member, viewer)),
    invitations: organizationInvitations.map(toInvitationRow),
    workspaces: roster.workspaces.map((workspace) => {
      const members = (membersByWorkspace.get(workspace.id) ?? []).map(({ row, access }) =>
        toWorkspaceMemberRow(row, access, viewer)
      )
      const invitations = (invitationsByWorkspace.get(workspace.id) ?? []).map(
        ({ row, access }) => ({
          ...toInvitationRow(row),
          key: `${workspace.id}/${row.id}`,
          permission: access.permission,
        })
      )
      return {
        id: workspace.id,
        name: workspace.name,
        total: members.length + invitations.length,
        members,
        invitations,
      }
    }),
  }
}

export interface SeatsModel {
  kind: 'none' | 'team' | 'enterprise'
  used: number
  total: number
  pending: number
  overLimit: boolean
}

function toSeatsModel(
  data: NonNullable<ReturnType<typeof useOrganizationPlanSeats>['data']>['data']
): SeatsModel | null {
  const used = data.membersTotal
  const total = data.totalSeats
  const pending = Math.max(0, data.usedSeats - used)
  if (!data.subscriptionPlan) return { kind: 'none', used, total, pending, overLimit: false }
  const enterprise = checkEnterprisePlan({
    plan: data.subscriptionPlan,
    status: data.subscriptionStatus ?? 'active',
  })
  // A Team plan with no seat count yet has nothing true to say.
  if (!enterprise && total === 0) return null
  return {
    kind: enterprise ? 'enterprise' : 'team',
    used,
    total,
    pending,
    overLimit: total > 0 && used > total,
  }
}

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
        ? toRosterModel(roster.data, { userId: viewerId, canManage, hosted })
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

function matches(row: { name: string; email: string }, query: string): boolean {
  return row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query)
}

/** Narrows every section to `query`; a section with no match leaves the result while searching. */
export function filterRoster(model: RosterModel, search: string): RosterModel {
  const query = search.trim().toLowerCase()
  if (!query) return model
  return {
    ...model,
    members: model.members.filter((row) => matches(row, query)),
    invitations: model.invitations.filter((row) => matches(row, query)),
    workspaces: model.workspaces
      .map((workspace) => ({
        ...workspace,
        members: workspace.members.filter((row) => matches(row, query)),
        invitations: workspace.invitations.filter((row) => matches(row, query)),
      }))
      .filter((workspace) => workspace.members.length + workspace.invitations.length > 0),
  }
}

function leaveToAppEntry({ legacyOrigin }: PlatformOrganization) {
  window.location.href = `${legacyOrigin}${APP_ENTRY_PATH}`
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
      if (target.isSelf) leaveToAppEntry(organization)
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
    portalPending: portal.isPending,
    portalError,
    /** The hook's default stays on the organization; this surface only offers hand-off and leave. */
    confirm: async (newOwnerUserId: string) => {
      const result = await transfer.mutateAsync({
        orgId: organizationId,
        newOwnerUserId,
        alsoLeave: true,
      })
      if (result.left) leaveToAppEntry(organization)
      else if (result.warning) toast.warning(`Ownership transferred. ${result.warning}`)
    },
    openBillingPortal: () => {
      setPortalError(null)
      const portalWindow = window.open('', '_blank')
      portal.mutate(
        {
          context: 'organization',
          organizationId,
          returnUrl: `${organization.legacyOrigin}${APP_ENTRY_PATH}`,
        },
        {
          onSuccess: (data) => {
            if (portalWindow) portalWindow.location.href = data.url
            else window.location.href = data.url
          },
          onError: (error) => {
            portalWindow?.close()
            setPortalError(
              getErrorMessage(error, 'Failed to open Stripe billing portal. Please try again.')
            )
          },
        }
      )
    },
  }
}

export function useMemberCredits(userId: string | undefined) {
  const organizationId = useOrganization().organization.id
  const limit = useOrganizationMemberUsageLimit(organizationId, userId, userId !== undefined)
  const update = useUpdateOrganizationMemberUsageLimit()
  return {
    loading: limit.isLoading,
    error: limit.error,
    retry: () => void limit.refetch(),
    usage: limit.data,
    save: async (creditLimit: number | null) => {
      if (!userId) return
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
        ? `Only ${available} seat${available === 1 ? '' : 's'} available — ${SEAT_WARNING}`
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
        result.added.length > 0 &&
          `${result.added.length} member${result.added.length === 1 ? '' : 's'} added`,
        result.successful.length > 0 &&
          `${result.successful.length} invite${result.successful.length === 1 ? '' : 's'} sent`,
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
