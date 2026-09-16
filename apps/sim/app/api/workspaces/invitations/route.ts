import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
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

    /**
     * The token stands in for being the invitee or a workspace admin on
     * `GET /api/invitations/[id]`, which answers with the invitee's address, the organization, and
     * every workspace the invitation grants. Its one use in the product is the admin-only "Copy
     * invite link" — yet every reader received it, for every invitation in every workspace they
     * could see.
     */
    /** Org admins arrive already promoted to `admin` by the row reader, so this covers them too. */
    const manageableWorkspaceIds = new Set(
      accessibleRows.filter((row) => row.permissionType === 'admin').map((row) => row.workspace.id)
    )

    const rows = await listInvitationsForWorkspaces(accessibleRows.map((row) => row.workspace.id))
    const invitations = rows.map((invitation) =>
      manageableWorkspaceIds.has(invitation.workspaceId) ? invitation : omit(invitation, ['token'])
    )

    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
})
