import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listInvitationsForWorkspaces } from '@/lib/invitations/core'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInvitationsAPI')

export const GET = withRouteHandler(async (req: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const accessibleRows = await listAccessibleWorkspaceRowsForUser(session.user.id)
    if (accessibleRows.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    const invitations = await listInvitationsForWorkspaces(
      accessibleRows.map((row) => row.workspace.id)
    )
    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
})
