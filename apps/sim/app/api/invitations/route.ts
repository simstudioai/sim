import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { InvitationDetails } from '@/lib/api/contracts/invitations'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listPendingInvitationsForEmail } from '@/lib/invitations/core'

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

    return NextResponse.json({
      invitations: invitations.map(
        (inv) =>
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
          }) satisfies InvitationDetails
      ),
    })
  } catch (error) {
    logger.error('Failed to list pending invitations', { error })
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 })
  }
})
