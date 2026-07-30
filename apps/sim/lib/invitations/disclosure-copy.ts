import { formatQuotedNameList } from '@sim/utils/string'
import type { InvitationJoinPreview } from '@/lib/api/contracts/invitations'

/**
 * Disclosure copy shown to an invitee before they accept.
 *
 * Shared by every accept surface — the emailed `/invite` page and the in-app
 * pending-invitations modal — so the two can never disclose different
 * consequences for the same invitation. An accept path that renders none of
 * this is a consent gap, not a styling difference.
 */

/** Names listed before collapsing the rest into an "and N more" tail. */
export const MAX_LISTED_WORKSPACE_NAMES = 3

/**
 * Names the invitee's own workspaces that accepting will move into the
 * organization, so accepting never silently changes who controls their work.
 *
 * Returns the itemized notice when the preview resolved, a generic one when it
 * could not be computed (a missing preview must never read as "nothing moves"),
 * and an empty string when nothing will move.
 */
export function buildWorkspaceMigrationNotice({
  joinPreview,
  joinPreviewUnavailable,
  membershipIntent,
  organizationLabel,
}: {
  joinPreview: InvitationJoinPreview | null
  joinPreviewUnavailable: boolean
  membershipIntent: 'internal' | 'external' | undefined
  organizationLabel: string
}): string {
  if (joinPreviewUnavailable && membershipIntent !== 'external') {
    return ` If you own personal workspaces, accepting membership moves them into ${organizationLabel}: its admins get full access, and they stay with the organization if you leave.`
  }

  if (joinPreview?.outcome !== 'will-join' || joinPreview.workspacesToMove.length === 0) {
    return ''
  }

  const names = joinPreview.workspacesToMove
  const nameList = formatQuotedNameList(names, MAX_LISTED_WORKSPACE_NAMES)
  const single = names.length === 1

  return ` Accepting also moves your ${single ? 'workspace' : 'workspaces'} ${nameList} into ${organizationLabel}: its admins get full access, and ${single ? 'it stays' : 'they stay'} with the organization if you leave.`
}

/**
 * States what the invitee becomes, so the seat consequence is disclosed to the
 * person it applies to rather than only to the inviter.
 *
 * Keyed on the preview's resolved `outcome` rather than the invitation's sent
 * intent, because acceptance can resolve an internal invite to something else —
 * the invitee already belongs to an organization, the granted workspace changed
 * organizations since the invite was sent, or acceptance will fail outright.
 * Promising a seat in those cases is exactly the disclosure/outcome mismatch
 * these notices exist to prevent. The sent intent is only the fallback for when
 * the preview could not be computed.
 */
export function buildMembershipNotice({
  joinPreview,
  membershipIntent,
  isOrganizationAdminRole,
  organizationLabel,
  isOrganizationScoped,
}: {
  joinPreview: InvitationJoinPreview | null
  membershipIntent: 'internal' | 'external' | undefined
  isOrganizationAdminRole: boolean
  organizationLabel: string
  isOrganizationScoped: boolean
}): string {
  if (!isOrganizationScoped || !membershipIntent) return ''

  /**
   * No preview means the outcome is genuinely unknown, and the callers also send
   * no disclosure token, so acceptance runs without the consent guards. Asserting
   * a seat-taking join here would be a promise nothing verifies — acceptance may
   * resolve to external, already-a-member, or a failure. The copy is conditional
   * instead: the consequence is still disclosed, without claiming it as settled.
   */
  if (!joinPreview) {
    if (membershipIntent === 'external') {
      return ` You'll join as an external collaborator: you get access to the invited workspaces only, and you don't take one of their seats.`
    }
    return ` If you're added to ${organizationLabel} as a member, that uses one of their seats.`
  }

  const outcome = joinPreview.outcome

  switch (outcome) {
    /**
     * Acceptance will fail (`upgrade-required`, `workspace-not-found`), so
     * nothing is promised. Silence is the honest answer: the invitee sees the
     * real cause when they accept. Claiming external access here — which is what
     * a boolean shape forced — was actively false.
     */
    case 'blocked':
      return ''
    /**
     * Already in the organization: their standing is unchanged, so neither the
     * join copy nor the external copy is true.
     */
    case 'already-member':
      return ` You're already a member of ${organizationLabel}, so accepting only adds the workspaces above — your membership and seat don't change.`
    case 'external':
      return ` You'll join as an external collaborator: you get access to the ${
        organizationLabel === 'the organization' ? 'invited' : organizationLabel
      } workspaces only, you don't take one of their seats, and everything you own stays yours.`
    case 'will-join':
      return ` You'll join ${organizationLabel} as ${
        isOrganizationAdminRole ? 'an admin' : 'a member'
      }, which uses one of their seats.`
  }
}
