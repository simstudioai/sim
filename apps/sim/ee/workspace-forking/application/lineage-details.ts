import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getEffectiveWorkspacePermission } from '@/lib/workspaces/permissions/utils'
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

import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

/**
 * The workspace's `forkSyncNewWorkflowsExcluded` policy: whether a workflow created now
 * starts outside fork sync. `false` for an archived or missing workspace: a wrongly-synced
 * workflow is visible and fixable in the Forks list, while a wrongly-excluded one silently
 * stops syncing.
 */
async function readForkSyncNewWorkflowsExcluded(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ excluded: workspace.forkSyncNewWorkflowsExcluded })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  return row?.excluded ?? false
}

export const getWorkspaceForkLineageDetails = defineForkUseCase({
  operation: forkOperations.discover,
  availability: true,
  async execute({
    input,
    context,
  }: {
    input: { workspaceId: string }
    context: { userId: string }
  }) {
    const { workspaceId } = input
    const [rawParent, rawChildren, run, forkSyncNewWorkflowsExcluded] = await Promise.all([
      getForkParent(workspaceId),
      getForkChildren(workspaceId),
      getUndoableRunForTarget(db, workspaceId),
      // Lineage-uniform, so this workspace's own value is the lineage's value.
      readForkSyncNewWorkflowsExcluded(workspaceId),
    ])

    const [parent, children] = await Promise.all([
      rawParent ? withViewerAccess(rawParent, context.userId) : null,
      Promise.all(rawChildren.map((child) => withViewerAccess(child, context.userId))),
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

    return {
      workspaceId,
      parent,
      children: children.map((child) => ({
        ...child,
        createdAt: child.createdAt.toISOString(),
      })),
      undoableRun,
      forkSyncNewWorkflowsExcluded,
    }
  },
})
