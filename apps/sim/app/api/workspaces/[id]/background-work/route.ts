import { db } from '@sim/db'
import { type NextRequest, NextResponse } from 'next/server'
import { getWorkspaceBackgroundWorkContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listSurfacedBackgroundWork } from '@/ee/workspace-forking/lib/background-work/store'
import { assertWorkspaceAdminAccess } from '@/ee/workspace-forking/lib/lineage/authz'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceBackgroundWorkContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { cursor, limit } = parsed.data.query

    // The fork Activity feed is a fork feature: gate it behind the same forking-enabled +
    // workspace-admin check the other fork routes use, instead of a bare access check.
    await assertWorkspaceAdminAccess(id, session.user.id)

    const { rows, nextCursor } = await listSurfacedBackgroundWork(db, id, { cursor, limit })
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
      nextCursor,
    })
  }
)
