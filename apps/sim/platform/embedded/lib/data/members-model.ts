import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import type {
  OrganizationRoster,
  RosterMember,
  RosterPendingInvitation,
  RosterWorkspaceAccess,
} from '@/lib/api/contracts/organization'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { workspaceRoleLockReason } from '@/lib/workspaces/permissions/role-lock'
import type { useOrganizationPlanSeats } from '@/hooks/queries/organization-plan-seats'
import { formatInstantDate } from '@/platform/embedded/lib/time'

type OrganizationRole = RosterMember['role']
export type WorkspacePermission = RosterWorkspaceAccess['permission']

/** Assignable roles, the default first. */
export const ORGANIZATION_ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

export const ORGANIZATION_ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  external: 'External',
}

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
  /** The roster renders on the server, so its dates wait for the zone both renders agree on. */
  timeZone: string
}

function joinedLabel(member: RosterMember, timeZone: string): string {
  if (member.suspendedAt) return 'Deactivated by your directory'
  return `Joined ${formatInstantDate(member.createdAt, timeZone)}`
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
    status: joinedLabel(member, viewer.timeZone),
    isSelf,
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

export function toRosterModel(roster: OrganizationRoster, viewer: RosterViewer): RosterModel {
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

interface SeatsModel {
  kind: 'none' | 'team' | 'enterprise'
  used: number
  total: number
  pending: number
  overLimit: boolean
}

export function toSeatsModel(
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
