import { db } from '@sim/db'
import { type NextRequest, NextResponse } from 'next/server'
import { getWorkspaceBackgroundWorkContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listSurfacedBackgroundWork } from '@/lib/workspaces/fork/background-work/store'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceBackgroundWorkContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params

    const access = await checkWorkspaceAccess(id, session.user.id)
    if (!access.exists) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (!access.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await listSurfacedBackgroundWork(db, id)
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        workflowId: row.workflowId,
        kind: row.kind,
        status: row.status,
        message: row.message,
        error: row.error,
        metadata: row.metadata ?? null,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      })),
    })
  }
)
