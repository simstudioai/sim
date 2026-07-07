import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getForkLineageContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertWorkspaceAdminAccess } from '@/lib/workspaces/fork/lineage/authz'
import { getForkChildren, getForkParent } from '@/lib/workspaces/fork/lineage/lineage'
import { getUndoableRunForTarget } from '@/lib/workspaces/fork/promote/promote-run-store'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkLineageContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params

    await assertWorkspaceAdminAccess(workspaceId, session.user.id)

    const [parent, children, run] = await Promise.all([
      getForkParent(workspaceId),
      getForkChildren(workspaceId),
      getUndoableRunForTarget(db, workspaceId),
    ])

    let undoableRun: {
      otherWorkspaceId: string
      otherName: string
      direction: 'push' | 'pull'
    } | null = null
    if (run) {
      const [other] = await db
        .select({ name: workspace.name })
        .from(workspace)
        .where(eq(workspace.id, run.sourceWorkspaceId))
        .limit(1)
      undoableRun = {
        otherWorkspaceId: run.sourceWorkspaceId,
        otherName: other?.name ?? 'workspace',
        direction: run.direction,
      }
    }

    return NextResponse.json({
      workspaceId,
      parent,
      children: children.map((child) => ({
        ...child,
        createdAt: child.createdAt.toISOString(),
      })),
      undoableRun,
    })
  }
)
