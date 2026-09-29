import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, asc, inArray, isNull, ne } from 'drizzle-orm'
import { captureServerEvent } from '@/lib/posthog/server'
import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'
import {
  acquireForkLineageLock,
  setForkLockTimeout,
} from '@/ee/workspace-forking/lib/lineage/lineage'
import {
  resolveForkLineageRootId,
  resolveForkLineageWorkspaceIds,
} from '@/ee/workspace-forking/lib/lineage/lineage-root'

export interface SetForkSyncDefaultInput {
  workspaceId: string
  excludeNewWorkflows: boolean
}

export interface SetForkSyncDefaultResult {
  excludeNewWorkflows: boolean
  /**
   * Exactly the lineage members whose value changed, empty when it already matched
   * everywhere. The audit fan-out projects one entry per element, and the surface derives
   * its `workspacesUpdated` count from the length - one source of truth, so the count can
   * never disagree with the entries actually filed.
   */
  changedWorkspaces: Array<{ id: string; name: string }>
}

/**
 * Set whether newly created workflows start OUTSIDE fork sync, for an entire fork lineage.
 *
 * Admin on the calling workspace is enough: the default is meaningless unless it is
 * uniform across a lineage, so the write fans out to every ancestor and descendant. It is
 * forward-only - no existing workflow's `forkSyncExcluded` is touched, so flipping it can
 * never move a workflow in or out of sync behind an admin's back.
 *
 * Serialized on the lineage-root advisory lock, which fork creation also takes, so a fork
 * created concurrently cannot inherit a stale value.
 */
export const setForkSyncDefault = defineForkUseCase<
  typeof forkOperations.syncDefault,
  SetForkSyncDefaultInput,
  SetForkSyncDefaultResult
>({
  operation: forkOperations.syncDefault,
  async execute({ input }) {
    // The root is the lock key, so it is resolved before the lock; membership is expanded under it.
    const rootId = await resolveForkLineageRootId(db, input.workspaceId)
    return db.transaction(async (tx) => {
      await setForkLockTimeout(tx)
      // Rank 2 - see the rank table on `acquireForkLineageLock`.
      await acquireForkLineageLock(tx, rootId)
      // Expanded under the lock, so a fork created a moment ago is included and one being
      // created now waits on the same key. A root that no longer reaches the caller means an
      // unlink moved it before we locked, and this key no longer covers its lineage.
      const lineageWorkspaceIds = await resolveForkLineageWorkspaceIds(tx, rootId)
      if (!lineageWorkspaceIds.includes(input.workspaceId)) {
        throw new ForkError(
          'The fork lineage changed while this request was being applied. Try again.',
          409
        )
      }
      // Rank 6: lock the live members whose value differs, in id order, since a multi-row
      // UPDATE locks in plan order and could deadlock against other multi-workspace writers.
      // NO KEY UPDATE keeps FK inserts into these workspaces (KEY SHARE) from queueing behind
      // the write. Nothing else writes this column under the lineage lock, so the filter holds.
      const toChange = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            inArray(workspace.id, lineageWorkspaceIds),
            isNull(workspace.archivedAt),
            ne(workspace.forkSyncNewWorkflowsExcluded, input.excludeNewWorkflows)
          )
        )
        .orderBy(asc(workspace.id))
        .for('no key update')
      if (toChange.length === 0) {
        return { excludeNewWorkflows: input.excludeNewWorkflows, changedWorkspaces: [] }
      }
      const changed = await tx
        .update(workspace)
        .set({ forkSyncNewWorkflowsExcluded: input.excludeNewWorkflows, updatedAt: new Date() })
        .where(
          inArray(
            workspace.id,
            toChange.map((member) => member.id)
          )
        )
        .returning({ id: workspace.id, name: workspace.name })
      return { excludeNewWorkflows: input.excludeNewWorkflows, changedWorkspaces: changed }
    })
  },
  /** One entry per member whose value changed, so every affected workspace's admins see it. */
  projectAudit: ({ input, context, result }) =>
    result.changedWorkspaces.map((member) => ({
      action: AuditAction.WORKSPACE_FORK_SYNC_DEFAULT_CHANGED,
      // The audit wrapper defaults `workspaceId` to the caller; file each entry in its own workspace.
      workspaceId: member.id,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: member.id,
      resourceName: member.name,
      description: input.excludeNewWorkflows
        ? 'New workflows no longer sync to forks by default'
        : 'New workflows sync to forks by default',
      metadata: {
        forkSyncNewWorkflowsExcluded: input.excludeNewWorkflows,
        originWorkspaceId: context.workspace.id,
        originWorkspaceName: context.workspace.name,
        workspacesChanged: result.changedWorkspaces.length,
      },
    })),
  afterSuccess({ context, input, result }) {
    if (result.changedWorkspaces.length === 0) return
    captureServerEvent(
      context.userId,
      'fork_sync_default_updated',
      {
        workspace_id: input.workspaceId,
        fork_sync_new_workflows_excluded: input.excludeNewWorkflows,
        workspaces_updated: result.changedWorkspaces.length,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
})
