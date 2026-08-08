import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { MyInvitation } from '@/lib/api/contracts/invitations'
import { getSession } from '@/lib/auth'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getInvitationJoinPreview, listPendingInvitationsForEmail } from '@/lib/invitations/core'

const logger = createLogger('MyInvitationsAPI')

/** Caps how many pooled connections one request can hold; a list is a handful of rows. */
const INVITATION_PREVIEW_CONCURRENCY = 4

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
     * Each preview issues up to three queries of its own, so a serial loop put
     * every one of them on the critical path of the switcher opening. The mapper
     * must stay total — `mapWithConcurrency` fails the whole batch on a throw.
     */
    const previews = await mapWithConcurrency(
      invitations,
      INVITATION_PREVIEW_CONCURRENCY,
      async (inv) => {
        try {
          return await getInvitationJoinPreview(session.user.id, inv)
        } catch (previewError) {
          logger.warn('Failed to compute join preview for pending invitation', {
            invitationId: inv.id,
            error: previewError,
          })
          return null
        }
      }
    )

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
