import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getForkLineageContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getEffectiveWorkspacePermission } from '@/lib/workspaces/permissions/utils'
import { assertWorkspaceAdminAccess } from '@/ee/workspace-forking/lib/lineage/authz'
import { getForkChildren, getForkParent } from '@/ee/workspace-forking/lib/lineage/lineage'
import { getUndoableRunForTarget } from '@/ee/workspace-forking/lib/promote/promote-run-store'

/**
 * Annotates a lineage node with whether the viewer holds any access to it (explicit
 * grant or org-admin derivation, via the canonical workspace-permission resolver).
 * Lineage rows are visible to any admin of the CURRENT workspace, who may have no
 * access to the other side of an edge; the flag drives per-action gating in the
 * Forks UI. Resolved per node - lineage children lists are small and bounded.
 */
async function withViewerAccess<T extends { id: string; organizationId: string | null }>(
  node: T,
  viewerId: string
): Promise<T & { viewerAccessible: boolean }> {
  const permission = await getEffectiveWorkspacePermission(viewerId, node)
  return { ...node, viewerAccessible: permission !== null }
}

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

    const [rawParent, rawChildren, run] = await Promise.all([
      getForkParent(workspaceId),
      getForkChildren(workspaceId),
      getUndoableRunForTarget(db, workspaceId),
    ])

    const [parent, children] = await Promise.all([
      rawParent ? withViewerAccess(rawParent, session.user.id) : null,
      Promise.all(rawChildren.map((child) => withViewerAccess(child, session.user.id))),
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
