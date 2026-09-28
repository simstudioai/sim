import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { and, inArray, isNull, ne, sql } from 'drizzle-orm'
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
    return db.transaction(async (tx) => {
      await setForkLockTimeout(tx)
      const rootId = await resolveForkLineageRootId(tx, input.workspaceId)
      // Rank 2, and the only fork lock this transaction takes before its rank-6 row
      // locks - see the rank table on `acquireForkLineageLock`.
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
      if (lineageWorkspaceIds.length === 0) {
        return { excludeNewWorkflows: input.excludeNewWorkflows, changedWorkspaces: [] }
      }
      // Rank 6: take the member row locks in sorted id order BEFORE the update. A bare
      // multi-row `UPDATE ... WHERE id IN (...)` acquires its row locks in whatever order
      // the plan produces, so it is unordered against any other multi-workspace writer
      // that takes no lineage lock - `lockWorkspaceRowsForPayerChanges` on the
      // organization-attach path is one today. `revision.ts` locks this same table with an
      // explicit `ORDER BY id FOR UPDATE` for exactly this reason; Drizzle's
      // `.update().where(inArray(...))` cannot express ORDER BY, so this is the same
      // lock-then-update shape.
      const memberIds = sql.join(
        [...lineageWorkspaceIds].sort(compareStrings).map((id) => sql`${id}`),
        sql`, `
      )
      await tx.execute(
        sql`SELECT id FROM ${workspace} WHERE id IN (${memberIds}) ORDER BY id FOR UPDATE`
      )
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
        // Return the NAME too, so the audit fan-out can identify each member the way a
        // reader knows it. Projecting a bare id as `resourceName` made every entry but the
        // caller's read as a raw identifier in the audit log.
        .returning({ id: workspace.id, name: workspace.name })
      return {
        excludeNewWorkflows: input.excludeNewWorkflows,
        // The members whose value ACTUALLY changed, not every member considered. Auditing
        // the whole lineage would file a change record against a workspace that already
        // held the requested value, making its history claim something that did not happen.
        changedWorkspaces: changed,
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
    result.changedWorkspaces.map((member) => ({
      action: AuditAction.WORKSPACE_FORK_SYNC_DEFAULT_CHANGED,
      // File each entry in the workspace it describes, not the caller's. The audit
      // wrapper defaults `workspaceId` to the initiating workspace, which would land
      // every entry in one log and leave the other members' admins with no record of
      // their own workspace changing - the exact gap this per-member fan-out exists
      // to close.
      workspaceId: member.id,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: member.id,
      // The member's own name, read back from the UPDATE. Falling back to the id for
      // every member but the caller made a lineage-wide change read as one named
      // workspace and N opaque identifiers.
      resourceName: member.name,
      description: input.excludeNewWorkflows
        ? 'New workflows no longer sync to forks by default'
        : 'New workflows sync to forks by default',
      metadata: {
        forkSyncNewWorkflowsExcluded: input.excludeNewWorkflows,
        // Which workspace in the lineage the admin changed it from, so a member's own
        // log explains why its behaviour moved without an action taken on it.
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
