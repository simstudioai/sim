import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { MyInvitation } from '@/lib/api/contracts/invitations'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getInvitationJoinPreview, listPendingInvitationsForEmail } from '@/lib/invitations/core'

const logger = createLogger('MyInvitationsAPI')

/**
 * Pending invitations addressed to the session's email — the invitee-facing
 * list behind the workspace switcher's Invitations section. Acceptance is
 * session-bound (email match), so rows deliberately exclude the token.
 */
export const GET = withRouteHandler(async () => {
  const session = await getSession()

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const invitations = await listPendingInvitationsForEmail(session.user.email)

    /**
     * Each row carries what accepting it will actually do, so the in-app list
     * can disclose the workspace migration and echo `disclosedWorkspaceIds` on
     * accept — the same consent contract the emailed `/invite` page honours.
     * Disclosure-only, so a preview failure degrades to `null` (the client
     * shows a generic notice) rather than hiding the invitation.
     *
     * Sequential on purpose: each preview issues several queries, and this
     * endpoint is hit whenever the workspace switcher opens. Fanning them out
     * with `Promise.all` would hold one pooled connection per pending
     * invitation for the length of the slowest one. The list is a handful of
     * rows, so the added latency is not worth the pool pressure.
     */
    const previews: Array<Awaited<ReturnType<typeof getInvitationJoinPreview>> | null> = []
    for (const inv of invitations) {
      try {
        previews.push(await getInvitationJoinPreview(session.user.id, inv))
      } catch (previewError) {
        logger.warn('Failed to compute join preview for pending invitation', {
          invitationId: inv.id,
          error: previewError,
        })
        previews.push(null)
      }
    }

    return NextResponse.json({
      invitations: invitations.map(
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
          }) satisfies MyInvitation
      ),
    })
  } catch (error) {
    logger.error('Failed to list pending invitations', { error })
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 })
  }
})
