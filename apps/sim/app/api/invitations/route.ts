import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listPendingInvitationsForViewer } from '@/lib/invitations/pending'

const logger = createLogger('InvitationsAPI')

/**
 * Pending invitations addressed to the session's email — the invitee-facing
 * list behind the workspace switcher's Invitations section.
 */
export const GET = withRouteHandler(async () => {
  const session = await getSession()

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const invitations = await listPendingInvitationsForViewer(session.user.id, session.user.email)
    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Failed to list pending invitations', { error })
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 })
  }
})
