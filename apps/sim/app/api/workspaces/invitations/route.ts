import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listInvitationsForWorkspaces } from '@/lib/invitations/core'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInvitationsAPI')

export const GET = withRouteHandler(async (req: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userWorkspaces = await db
      .select({ id: workspace.id })
      .from(workspace)
      .innerJoin(
        permissions,
        and(
          eq(permissions.entityId, workspace.id),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.userId, session.user.id)
        )
      )
      .where(isNull(workspace.archivedAt))

    if (userWorkspaces.length === 0) {
      return NextResponse.json({ invitations: [] })
    }

    const invitations = await listInvitationsForWorkspaces(userWorkspaces.map((w) => w.id))
    return NextResponse.json({ invitations })
  } catch (error) {
    logger.error('Error fetching workspace invitations:', error)
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
  }
})
