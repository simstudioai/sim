import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, inArray, isNull, ne } from 'drizzle-orm'
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
} from '@/ee/workspace-forking/lib/sync-default'

export interface SetForkSyncDefaultInput {
  workspaceId: string
  excludeNewWorkflows: boolean
}

export interface SetForkSyncDefaultResult {
  excludeNewWorkflows: boolean
  /** Lineage members whose value actually changed; 0 when it already matched everywhere. */
  workspacesUpdated: number
  /** Ids of exactly those changed members, which the audit fan-out projects from. */
  changedWorkspaceIds: string[]
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
    return db.transaction(async (tx) => {
      await setForkLockTimeout(tx)
      const rootId = await resolveForkLineageRootId(tx, input.workspaceId)
      await acquireForkLineageLock(tx, rootId)
      // Re-resolve under the lock and refuse if the root moved. An unlink committing
      // between the read and the lock would leave us holding the OLD lineage's key while
      // writing the new one's members, so a second write rooted at the new lineage could
      // run concurrently over the same rows. Mirrors the organization re-check `createFork`
      // performs under its own lock.
      if ((await resolveForkLineageRootId(tx, input.workspaceId)) !== rootId) {
        throw new ForkError(
          'The fork lineage changed while this request was being applied. Try again.',
          409
        )
      }
      // Resolve the membership AFTER the lock: a fork created a moment ago must be
      // included, and one being created right now is blocked on the same key.
      const lineageWorkspaceIds = await resolveForkLineageWorkspaceIds(tx, input.workspaceId)
      const changed = await tx
        .update(workspace)
        .set({ forkSyncNewWorkflowsExcluded: input.excludeNewWorkflows, updatedAt: new Date() })
        .where(
          and(
            inArray(workspace.id, lineageWorkspaceIds),
            // Re-assert liveness at write time: `resolveForkLineageWorkspaceIds` filtered
            // archived members when it read, but a workspace can be archived between that
            // read and this update, and a policy write must never touch one.
            isNull(workspace.archivedAt),
            ne(workspace.forkSyncNewWorkflowsExcluded, input.excludeNewWorkflows)
          )
        )
        .returning({ id: workspace.id })
      return {
        excludeNewWorkflows: input.excludeNewWorkflows,
        workspacesUpdated: changed.length,
        // The members whose value ACTUALLY changed, not every member considered. Auditing
        // the whole lineage would file a change record against a workspace that already
        // held the requested value, making its history claim something that did not happen.
        changedWorkspaceIds: changed.map((row) => row.id),
      }
    })
  },
  /**
   * One entry per workspace whose value actually changed. Every such member gets its own
   * record, because the default genuinely moved for each of them and a single entry on the
   * calling workspace would leave the others' admins with no trace. A member that already
   * held the requested value gets nothing - it did not change.
   */
  projectAudit: ({ input, context, result }) =>
    result.changedWorkspaceIds.map((memberId) => ({
      action: AuditAction.WORKSPACE_FORK_SYNC_DEFAULT_CHANGED,
      // File each entry in the workspace it describes, not the caller's. The audit
      // wrapper defaults `workspaceId` to the initiating workspace, which would land
      // every entry in one log and leave the other members' admins with no record of
      // their own workspace changing - the exact gap this per-member fan-out exists
      // to close.
      workspaceId: memberId,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: memberId,
      resourceName: memberId === context.workspace.id ? context.workspace.name : memberId,
      description: input.excludeNewWorkflows
        ? 'New workflows no longer sync to forks by default'
        : 'New workflows sync to forks by default',
      metadata: {
        forkSyncNewWorkflowsExcluded: input.excludeNewWorkflows,
        // Which workspace in the lineage the admin changed it from, so a member's own
        // log explains why its behaviour moved without an action taken on it.
        originWorkspaceId: context.workspace.id,
        originWorkspaceName: context.workspace.name,
        workspacesChanged: result.changedWorkspaceIds.length,
      },
    })),
  afterSuccess({ context, input, result }) {
    if (!result.workspacesUpdated) return
    captureServerEvent(
      context.userId,
      'fork_sync_default_updated',
      {
        workspace_id: input.workspaceId,
        fork_sync_new_workflows_excluded: input.excludeNewWorkflows,
        workspaces_updated: result.workspacesUpdated,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
})
