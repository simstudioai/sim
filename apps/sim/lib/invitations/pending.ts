import { createLogger } from '@sim/logger'
import type { ViewerInvitation } from '@/lib/api/contracts/invitations'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { getInvitationJoinPreview, listPendingInvitationsForEmail } from '@/lib/invitations/core'

const logger = createLogger('PendingInvitations')

/**
 * Bounds the join-preview fan-out. A pending-invitation list is a handful of rows, so this
 * resolves the common cases in one batch while still capping how many pooled connections a
 * single page render can hold.
 */
const INVITATION_PREVIEW_CONCURRENCY = 4

/**
 * The invitee-facing pending-invitation list behind the workspace switcher's
 * Invitations section, assembled once for both the `GET /api/invitations` route
 * and the sidebar's server prefetch so both cache one shape.
 *
 * Rows deliberately exclude the token: acceptance here is session-bound (email
 * match), which is what makes it immune to the wrong-browser-account problem.
 */
export async function listPendingInvitationsForViewer(
  userId: string,
  email: string
): Promise<ViewerInvitation[]> {
  const invitations = await listPendingInvitationsForEmail(email)

  /**
   * Each row carries what accepting it will actually do, so the client can echo
   * `disclosedWorkspaceIds` on accept — the consent contract the emailed
   * `/invite` page honours. A preview failure degrades to `null` rather than
   * hiding the invitation, which is what lets this run under a bounded mapper.
   *
   * Bounded rather than unbounded: each preview issues up to three sequential
   * queries, so `Promise.all` would hold one pooled connection per pending
   * invitation for the length of the slowest one. It was previously a serial
   * loop for that reason, which is no longer affordable now that the sidebar
   * prefetch calls this on every workspace page render rather than only when
   * the switcher opens — a serial loop puts every one of those queries on the
   * critical path of the first byte.
   */
  const previews = await mapWithConcurrency(
    invitations,
    INVITATION_PREVIEW_CONCURRENCY,
    async (inv) => {
      try {
        return await getInvitationJoinPreview(userId, inv)
      } catch (previewError) {
        logger.warn('Failed to compute join preview for pending invitation', {
          invitationId: inv.id,
          error: previewError,
        })
        return null
      }
    }
  )

  return invitations.map(
    (inv, index) =>
      ({
        id: inv.id,
        kind: inv.kind,
        email: inv.email,
        organizationId: inv.organizationId,
        organizationName: inv.organizationName,
        membershipIntent: inv.membershipIntent,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        inviterName: inv.inviterName,
        inviterEmail: inv.inviterEmail,
        grants: inv.grants.map((grant) => ({
          workspaceId: grant.workspaceId,
          workspaceName: grant.workspaceName,
          permission: grant.permission,
        })),
        joinPreview: previews[index],
      }) satisfies ViewerInvitation
  )
}
