import { workspaceRoleLockReason } from '@/components/permissions'
import type {
  OrganizationRoster,
  RosterMember,
  RosterWorkspaceAccess,
} from '@/lib/api/contracts/organization'

/** The three workspace permissions, weakest first — the order every access control reads. */
export const WORKSPACE_ACCESS_LEVELS = ['read', 'write', 'admin'] as const

export type WorkspaceAccessLevel = (typeof WORKSPACE_ACCESS_LEVELS)[number]

/** Display label for every workspace permission, shared by the tables and the modal. */
export const WORKSPACE_ACCESS_LABELS: Record<WorkspaceAccessLevel, string> = {
  read: 'Read',
  write: 'Write',
  admin: 'Admin',
}

/**
 * How a row's access reads in the table, naming where it comes from when it is
 * not a grant on this workspace.
 *
 * An organization admin holds admin on every workspace the organization owns,
 * and a workspace owner cannot drop below admin — neither is editable here, and
 * an unqualified "Admin" makes those rows indistinguishable from an ordinary
 * grant another admin CAN edit. That ambiguity is the whole reason their
 * checkbox and dropdown are inert, so the level says it outright rather than
 * leaving a tooltip to explain an apparent bug.
 *
 * The filter dropdown keeps the plain {@link WORKSPACE_ACCESS_LABELS} — it
 * filters on the permission, which is `admin` either way.
 */
export function workspaceAccessLabel(access: RosterWorkspaceAccess): string {
  const level = WORKSPACE_ACCESS_LABELS[access.permission]
  if (access.roleSource === 'org-admin') return `${level} (Organization)`
  if (access.roleSource === 'owner') return `${level} (Owner)`
  return level
}

/** One workspace the organization owns, as the roster reports it. */
export type RosterWorkspace = OrganizationRoster['workspaces'][number]

interface WorkspaceAccessRowBase {
  /** Stable row identity — the org membership id, or the invitation id. */
  id: string
  name: string
  email: string
  image: string | null
  /** This row's standing in the workspace: permission, why it is fixed, billing. */
  access: RosterWorkspaceAccess
}

/** A joined organization member with access to the workspace. */
export type WorkspaceMemberRow = WorkspaceAccessRowBase & {
  kind: 'member'
  member: RosterMember
}

/** A pending invitation that grants access to the workspace once accepted. */
export type WorkspaceInviteRow = WorkspaceAccessRowBase & {
  kind: 'invite'
  invitationId: string
}

export type WorkspaceAccessRow = WorkspaceMemberRow | WorkspaceInviteRow

/** One workspace with everyone who can reach it, joined or invited. */
export interface WorkspaceGroup {
  workspace: RosterWorkspace
  members: WorkspaceMemberRow[]
  invites: WorkspaceInviteRow[]
}

function appendRow<T>(index: Map<string, T[]>, key: string, row: T) {
  const rows = index.get(key)
  if (rows) rows.push(row)
  else index.set(key, [row])
}

/**
 * Inverts the member-major roster into the workspace-major shape this page
 * reads: one entry per organization workspace, carrying its joined members and
 * its pending invitations.
 *
 * Both collections are indexed in a single pass keyed by workspace id — a
 * `.find` per workspace × member would make this O(workspaces × members ×
 * access-entries). Rows keep roster order within each workspace, and the
 * workspaces themselves keep the order the roster returned, which is the order
 * the organization already reads them in elsewhere.
 */
export function groupRosterByWorkspace(
  roster: OrganizationRoster | null | undefined
): WorkspaceGroup[] {
  if (!roster) return []

  const membersByWorkspace = new Map<string, WorkspaceMemberRow[]>()
  for (const member of roster.members) {
    const seen = new Set<string>()
    for (const access of member.workspaces) {
      if (seen.has(access.workspaceId)) continue
      seen.add(access.workspaceId)
      appendRow(membersByWorkspace, access.workspaceId, {
        kind: 'member',
        id: member.memberId,
        name: member.name,
        email: member.email,
        image: member.image,
        access,
        member,
      })
    }
  }

  const invitesByWorkspace = new Map<string, WorkspaceInviteRow[]>()
  for (const invitation of roster.pendingInvitations) {
    const seen = new Set<string>()
    for (const access of invitation.workspaces) {
      if (seen.has(access.workspaceId)) continue
      seen.add(access.workspaceId)
      appendRow(invitesByWorkspace, access.workspaceId, {
        kind: 'invite',
        id: invitation.id,
        name: invitation.inviteeName ?? invitation.email,
        email: invitation.email,
        image: invitation.inviteeImage,
        access,
        invitationId: invitation.id,
      })
    }
  }

  return roster.workspaces.map((workspace) => ({
    workspace,
    members: membersByWorkspace.get(workspace.id) ?? [],
    invites: invitesByWorkspace.get(workspace.id) ?? [],
  }))
}

/** Who is looking, and whether they administer the organization. */
interface AccessViewer {
  canManage: boolean
  currentUserId: string
}

const SELF_ADMIN_LOCK_REASON = 'You cannot remove your own admin access'

/**
 * Why this row's workspace access cannot be changed, or `null` when it can.
 *
 * Every reason has a matching guard on `PATCH /api/workspaces/[id]/permissions`,
 * so a locked control is one the server would have refused — plus the viewer's
 * own admin access, which they must not be able to drop out from under
 * themselves. A pending invitation's grant is always editable: nothing depends
 * on it until it is accepted.
 *
 * Single source for the table's control and the manage-access modal, so the two
 * cannot disagree about whether a row is editable.
 */
export function workspaceAccessLockReason(
  row: WorkspaceAccessRow,
  { canManage, currentUserId }: AccessViewer
): string | null {
  if (!canManage) return 'Only organization admins can change workspace access.'
  if (row.kind === 'invite') return null
  return (
    workspaceRoleLockReason(row.access.roleSource, {
      isBilledAccount: row.access.isBilledAccount,
    }) ??
    (row.member.userId === currentUserId && row.access.permission === 'admin'
      ? SELF_ADMIN_LOCK_REASON
      : null)
  )
}

/**
 * Whether this row's access to the workspace can be withdrawn — which drives
 * both the row's checkbox and the modal's destructive action.
 *
 * Keyed on how the access was GRANTED, not on the person's organization role.
 * A workspace admin is removable by another admin, including one who happens to
 * administer the organization: `DELETE /api/workspaces/members/[id]` has no
 * org-role guard, and even removing the workspace owner is allowed (it transfers
 * ownership). What it does refuse is the billing account, and a target holding
 * no permission row at all — which is exactly the `org-admin` case, where access
 * is derived from the organization rather than granted here, so there is nothing
 * to withdraw and removing it would leave them an admin anyway.
 *
 * The one rule the server does not enforce is the viewer's own row: removing
 * yourself would revoke the access you are managing from.
 */
export function isWorkspaceAccessRemovable(
  row: WorkspaceAccessRow,
  { canManage, currentUserId }: AccessViewer
): boolean {
  if (!canManage) return false
  if (row.kind === 'invite') return true
  if (row.access.roleSource === 'org-admin' || row.access.isBilledAccount) return false
  return row.member.userId !== currentUserId
}

/**
 * Whether a person row matches the page search. `query` must already be
 * trimmed and lowercased by the caller — it is compared once per row.
 */
export function rowMatchesQuery(row: WorkspaceAccessRow, query: string): boolean {
  if (!query) return true
  return row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query)
}

/**
 * Whether a workspace matches the page search. One predicate serves both views:
 * a (workspace, person) pair matches when either side does, so the list keeps a
 * workspace whose members match, and the detail keeps every member of a
 * workspace whose own name matched.
 */
export function groupMatchesQuery(group: WorkspaceGroup, query: string): boolean {
  if (!query) return true
  if (group.workspace.name.toLowerCase().includes(query)) return true
  return (
    group.members.some((row) => rowMatchesQuery(row, query)) ||
    group.invites.some((row) => rowMatchesQuery(row, query))
  )
}
