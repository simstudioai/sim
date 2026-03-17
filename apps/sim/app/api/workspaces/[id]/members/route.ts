import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  getUserEntityPermissions,
  getWorkspaceMemberProfiles,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceMembersAPI')

/**
 * GET /api/workspaces/[id]/members
 *
 * Returns lightweight member profiles (id, name, image) for a workspace.
 * Intended for UI display (avatars, owner cells) without the overhead of
 * full permission data.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission === null) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    const members = await getWorkspaceMemberProfiles(workspaceId)

    return NextResponse.json({ members })
  } catch (error) {
    logger.error('Error fetching workspace members:', error)
    return NextResponse.json({ error: 'Failed to fetch workspace members' }, { status: 500 })
  }
}
