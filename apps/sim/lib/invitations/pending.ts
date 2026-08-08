import { createLogger } from '@sim/logger'
import type { ViewerInvitation } from '@/lib/api/contracts/invitations'
import { getInvitationJoinPreview, listPendingInvitationsForEmail } from '@/lib/invitations/core'

const logger = createLogger('PendingInvitations')

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
   * hiding the invitation.
   *
   * Sequential on purpose: each preview issues several queries, and the sidebar
   * prefetch calls this on every workspace page load. Fanning them out with
   * `Promise.all` would hold one pooled connection per pending invitation for
   * the length of the slowest one. The list is a handful of rows, so the added
   * latency is not worth the pool pressure.
   */
  const previews: Array<Awaited<ReturnType<typeof getInvitationJoinPreview>> | null> = []
  for (const inv of invitations) {
    try {
      previews.push(await getInvitationJoinPreview(userId, inv))
    } catch (previewError) {
      logger.warn('Failed to compute join preview for pending invitation', {
        invitationId: inv.id,
        error: previewError,
      })
      previews.push(null)
    }
  }

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
