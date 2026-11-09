'use client'

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import type { MyInvitation } from '@/lib/api/contracts/invitations'
import { getInvitationErrorMessage } from '@/lib/invitations/error-messages'
import { toast } from '@/lib/toast/sink'
import {
  useAcceptMyInvitation,
  useDeclineMyInvitation,
  useMyPendingInvitations,
} from '@/hooks/queries/invitations'

const logger = createLogger('PendingInvitations')

interface InvitationListItem {
  id: string
  label: string
  description?: string
}

/** One of the viewer's pending invitations, as the organization menu's dialog shows it. */
export interface PendingInvitation {
  id: string
  label: string
  inviter: string
  /** The workspace a single-workspace invitation opens, named on the invitation's own row. */
  workspace: { name: string; logo?: string; access: string } | null
  organization: boolean
  /** What joining does to the viewer's organization and personal workspaces, read before accepting. */
  joinNotice: { paragraphs: readonly string[]; moving: readonly InvitationListItem[] } | null
  grants: readonly InvitationListItem[]
  /** The join preview failed to load; accepting waits for a refresh that discloses it. */
  needsRefresh: boolean
}

/**
 * Organization invitations take the organization's name, even when workspace grants ride along;
 * workspace invitations take their first workspace's, as the emailed `/invite` page does.
 */
function invitationLabel(invitation: MyInvitation): string {
  if (invitation.kind === 'organization') return invitation.organizationName ?? 'Organization'
  const first = invitation.grants[0]?.workspaceName
  if (!first) return 'Workspace'
  const extra = invitation.grants.length - 1
  return extra > 0 ? `${first} +${extra}` : first
}

/** The emailed `/invite` page's disclosure, as plain sentences. */
function joinParagraphs(invitation: MyInvitation): string[] {
  const preview = invitation.joinPreview
  const outcome =
    preview?.outcome ?? (invitation.membershipIntent === 'external' ? 'external' : null)
  const organizationName =
    preview?.organizationName ??
    (invitation.kind === 'organization' ? invitation.organizationName : null) ??
    'the workspace’s organization'
  switch (outcome) {
    case 'will-join':
      return [
        `You will join ${organizationName} as an organization ${invitation.role}. This uses one organization seat.`,
        preview && preview.workspaceIdsToMove.length > 0
          ? 'Your owned personal workspaces, including archived workspaces, will move into the organization. Its administrators will be able to manage them.'
          : 'You have no personal workspaces to move into the organization.',
      ]
    case 'already-member':
      return [
        'You already belong to this organization. Your organization role will stay the same. No additional seat is used, and none of your personal workspaces will move.',
      ]
    case 'blocked':
      return [
        'This invitation cannot currently be accepted. Try accepting to see what needs to be resolved, or contact the person who invited you.',
      ]
    case null:
      return [
        'We could not load how this invitation affects your organization and personal workspaces. Refresh the invitation to review these details before accepting.',
      ]
    default:
      return []
  }
}

function toPendingInvitation(invitation: MyInvitation): PendingInvitation {
  const single =
    invitation.kind === 'workspace' && invitation.grants.length === 1 ? invitation.grants[0] : null
  const preview = invitation.joinPreview
  const showJoinNotice = preview
    ? preview.outcome !== 'external'
    : invitation.membershipIntent === 'internal'
  return {
    id: invitation.id,
    label: invitationLabel(invitation),
    inviter: invitation.inviterName ? `Invited by ${invitation.inviterName}` : 'Invited',
    workspace: single
      ? {
          name: single.workspaceName || 'Unnamed workspace',
          logo: single.workspaceLogoUrl ?? undefined,
          access: `${single.permission} access`,
        }
      : null,
    organization: invitation.kind === 'organization',
    joinNotice: showJoinNotice
      ? {
          paragraphs: joinParagraphs(invitation),
          moving:
            preview?.outcome === 'will-join'
              ? preview.workspaceIdsToMove.map((id, index) => ({
                  id,
                  label: preview.workspacesToMove[index] || 'Unnamed workspace',
                }))
              : [],
        }
      : null,
    grants: single
      ? []
      : invitation.grants.map((grant) => ({
          id: grant.workspaceId,
          label: grant.workspaceName || 'Unnamed workspace',
          description: `${grant.permission} access`,
        })),
    needsRefresh: invitation.membershipIntent === 'internal' && !preview,
  }
}

/**
 * Whether the viewer has invitations waiting, read when the organization menu opens and cached
 * between opens, so most viewers, who have none, never fetch on load.
 */
export function useHasPendingInvitations(): boolean {
  const { data } = useMyPendingInvitations()
  return Boolean(data && data.length > 0)
}

/**
 * The viewer's pending invitations and their decisions. Accepting is bound to the session's email,
 * not a token, so it works whichever browser opened the emailed link, and it echoes the disclosure
 * the dialog showed so the server refuses a sweep the viewer never read. An accepted invitation
 * opens what it joined; a declined one leaves the rest to decide.
 */
export function usePendingInvitations(open: boolean) {
  const query = useMyPendingInvitations(open)
  const acceptMutation = useAcceptMyInvitation()
  const declineMutation = useDeclineMyInvitation()
  const router = useRouter()
  const invitations = query.data ?? []
  const busy = acceptMutation.isPending || declineMutation.isPending
  const find = (id: string) => invitations.find((invitation) => invitation.id === id)

  return {
    status: query.status,
    error: query.error,
    fetching: query.isFetching,
    retry: () => void query.refetch(),
    rows: invitations.map(toPendingInvitation),
    busy,
    /** Resolves with whether the invitation was accepted, after which the dialog closes. */
    async accept(id: string): Promise<boolean> {
      const invitation = find(id)
      if (!invitation || busy) return false
      if (invitation.membershipIntent === 'internal' && !invitation.joinPreview) return false
      try {
        const result = await acceptMutation.mutateAsync({
          invitationId: invitation.id,
          disclosedWorkspaceIds: invitation.joinPreview?.workspaceIdsToMove,
          disclosedOutcome: invitation.joinPreview?.outcome,
        })
        toast.success(`Joined ${invitationLabel(invitation)}`)
        router.push(result.redirectPath)
        return true
      } catch (error) {
        logger.error('Failed to accept invitation', { error })
        toast.error(
          getInvitationErrorMessage(
            getErrorMessage(error, ''),
            'Could not accept the invitation. It may have expired.'
          )
        )
        return false
      }
    },
    async decline(id: string): Promise<void> {
      try {
        await declineMutation.mutateAsync({ invitationId: id })
      } catch (error) {
        logger.error('Failed to decline invitation', { error })
        toast.error(
          getInvitationErrorMessage(getErrorMessage(error, ''), 'Could not decline the invitation.')
        )
      }
    },
  }
}
