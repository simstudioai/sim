import type { RosterMember, RosterPendingInvitation } from '@/lib/api/contracts/organization'

/** The four organization roles the roster can report. */
export type OrganizationMemberRole = RosterMember['role']

/** Display label for every organization role, shared by the table and the modal. */
export const ORGANIZATION_ROLE_LABELS: Record<OrganizationMemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  external: 'External',
}

interface OrganizationRosterRowBase {
  /**
   * Stable row identity. Invitation ids are namespaced so a member and an
   * invitation can never collide in the table's selection set.
   */
  id: string
  name: string
  email: string
  image: string | null
  role: OrganizationMemberRole
  /** Join (member) or invite (invitation) date, in epoch milliseconds, for ordering. */
  createdAt: number
  /**
   * Whether the row may take part in its tab's bulk action — removal on the
   * members tab, revocation on the invitations tab.
   */
  selectable: boolean
}

export interface OrganizationMemberRow extends OrganizationRosterRowBase {
  kind: 'member'
  member: RosterMember
}

export interface OrganizationInvitationRow extends OrganizationRosterRowBase {
  kind: 'invitation'
  invitation: RosterPendingInvitation
}

/** One row of the organization members table — an accepted member or a pending invitation. */
export type OrganizationRosterRow = OrganizationMemberRow | OrganizationInvitationRow

interface MemberRowContext {
  /** Whether the viewer administers the organization. */
  canManage: boolean
  currentUserId: string
}

/**
 * Projects a roster member onto a table row. `selectable` mirrors what the
 * removal route accepts: the owner cannot be removed, and leaving is a
 * deliberate single-member flow rather than something a bulk action performs.
 */
export function toOrganizationMemberRow(
  member: RosterMember,
  { canManage, currentUserId }: MemberRowContext
): OrganizationMemberRow {
  return {
    id: member.memberId,
    kind: 'member',
    name: member.name,
    email: member.email,
    image: member.image,
    role: member.role,
    createdAt: new Date(member.createdAt).getTime(),
    selectable: canManage && member.role !== 'owner' && member.userId !== currentUserId,
    member,
  }
}

/**
 * Projects a pending organization invitation onto a table row. Every pending
 * invitation is revocable by an admin — there is no owner-equivalent to protect
 * here — so `selectable` follows the viewer's authority alone.
 */
export function toOrganizationInvitationRow(
  invitation: RosterPendingInvitation,
  { canManage }: { canManage: boolean }
): OrganizationInvitationRow {
  return {
    id: `invitation:${invitation.id}`,
    kind: 'invitation',
    name: invitation.inviteeName ?? invitation.email,
    email: invitation.email,
    image: invitation.inviteeImage,
    role:
      invitation.membershipIntent === 'external'
        ? 'external'
        : invitation.role === 'admin'
          ? 'admin'
          : 'member',
    createdAt: new Date(invitation.createdAt).getTime(),
    selectable: canManage,
    invitation,
  }
}
