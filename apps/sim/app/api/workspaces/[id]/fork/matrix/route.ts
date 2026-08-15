import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { ForkForestNode } from '@/lib/api/contracts/workspace-fork'
import { getForkMatrixContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getManageableWorkspaces } from '@/lib/workspaces/permissions/utils'
import { assertWorkspaceAdminAccess, ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import { getForkForest } from '@/ee/workspace-forking/lib/lineage/forest'
import { getForkMatrix } from '@/ee/workspace-forking/lib/mapping/matrix'

/**
 * The lineage rooted at `rootId`, depth-first, restricted to the workspaces the viewer can
 * actually see.
 *
 * An inaccessible workspace truncates the lineage at that point rather than being skipped over:
 * the matrix labels every resource it lists, so composing a chain THROUGH a workspace the viewer
 * has no access to would report that workspace's resource names to someone who cannot open it.
 */
function visibleLineage(nodes: ForkForestNode[], rootId: string): ForkForestNode[] {
  const childrenByParent = new Map<string, ForkForestNode[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const siblings = childrenByParent.get(node.parentId)
    if (siblings) siblings.push(node)
    else childrenByParent.set(node.parentId, [node])
  }

  const root = nodes.find((node) => node.id === rootId)
  if (!root || !root.viewerAccessible) return []

  const lineage: ForkForestNode[] = []
  const visit = (node: ForkForestNode) => {
    lineage.push(node)
    for (const child of childrenByParent.get(node.id) ?? []) {
      if (child.viewerAccessible) visit(child)
    }
  }
  visit(root)
  return lineage
}

/**
 * The mappings matrix for one lineage: every resource chain across its workspaces, plus the
 * targets each cell may be re-pointed at.
 *
 * Admin on the anchor is the gate, as on every fork route; the lineage is then narrowed to the
 * workspaces the viewer can see, and each column reports whether the viewer may edit the edge
 * that lands in it.
 */
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkMatrixContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { rootId } = parsed.data.query

    await assertWorkspaceAdminAccess(workspaceId, session.user.id)

    const manageable = await getManageableWorkspaces(session.user.id)
    const nodes = await getForkForest({
      anchorWorkspaceId: workspaceId,
      viewerId: session.user.id,
      manageableWorkspaceIds: manageable.map((entry) => entry.id),
    })

    const lineage = visibleLineage(nodes, rootId)
    if (lineage.length === 0) {
      throw new ForkError('That lineage is not reachable from this workspace', 404)
    }

    const lineageIds = new Set(lineage.map((node) => node.id))
    const columns = lineage.map((node) => ({
      id: node.id,
      // The root's own parent sits outside this matrix, so it anchors no edge here.
      parentId: node.parentId && lineageIds.has(node.parentId) ? node.parentId : null,
    }))

    const matrix = await getForkMatrix(columns)

    return NextResponse.json({
      rootWorkspaceId: rootId,
      workspaces: lineage.map((node) => ({
        id: node.id,
        name: node.name,
        color: node.color,
        logoUrl: node.logoUrl,
        parentId: node.parentId && lineageIds.has(node.parentId) ? node.parentId : null,
        viewerCanAdmin: node.viewerCanAdmin,
      })),
      ...matrix,
    })
  }
)
