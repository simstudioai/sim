import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  userTableDefinitions,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { isRecord, type SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import { invalidateDeployedStateCache } from '@/lib/workflows/persistence/utils'
import type { ForkFailedResource } from '@/lib/workspaces/fork/copy/copy-resources'
import type { ForkCopyResolver } from '@/lib/workspaces/fork/remap/fork-bootstrap'
import {
  clearDependentsOnRemap,
  type ForkRemapKind,
  remapForkSubBlocks,
} from '@/lib/workspaces/fork/remap/remap-references'

const logger = createLogger('WorkspaceForkCleanupFailed')

/** Child workflow ids loaded per page so the block sweep never materializes the whole workspace. */
const WORKFLOW_PAGE = 200

/** Deployment versions loaded per page so a workflow with many versions never loads all at once. */
const DEPLOYMENT_VERSION_PAGE = 100

/** Identity-or-clear resolver: a failed id resolves to null (cleared), any other id to itself. */
function buildFailedResolver(failedByKind: Map<ForkRemapKind, Set<string>>): ForkCopyResolver {
  return (kind, id) => (failedByKind.get(kind)?.has(id) ? null : id)
}

/**
 * Apply the identity-or-clear resolver to one block's subBlocks: a value (top-level selector or
 * nested tool param) that resolves to a failed id is cleared, and its `dependsOn` children with it;
 * everything else is left untouched. Returns the rewritten record plus whether anything changed.
 * Shared by the draft block sweep and the deployment-version state sweep so both clear identically.
 */
function clearFailedSubBlockReferences(
  subBlocks: SubBlockRecord,
  blockType: string,
  resolve: ForkCopyResolver
): { subBlocks: SubBlockRecord; changed: boolean } {
  const result = remapForkSubBlocks(subBlocks, resolve, 'create')
  // remappedKeys is non-empty only when a failed id was actually cleared, so a block that
  // referenced nothing failed is reported unchanged without a write.
  if (result.remappedKeys.size === 0) return { subBlocks, changed: false }
  return {
    subBlocks: clearDependentsOnRemap(result.subBlocks, blockType, result.remappedKeys),
    changed: true,
  }
}

/**
 * Clean up after a resource whose post-commit content fill failed: clear every subblock
 * reference in the child workspace's workflows that points at the failed resource (so no
 * subblock keeps a dead id), then drop the orphaned placeholder rows (a KB cascade-drops its
 * documents + embeddings; a table cascade-drops its rows). In-content references inside copied
 * skill/markdown bodies are intentionally left as graceful broken links rather than mutated.
 *
 * The deployed-version sweep covers the draft-affected workflows UNION this sync's deployed
 * target workflows (`deployedTargetWorkflowIds`): a deployed version can reference the dropped
 * placeholder even when the draft no longer does (the user edited the empty-looking block in the
 * fill window), so scoping to draft divergence alone would miss it.
 *
 * Best-effort and isolated: a failure cleaning one resource is logged and the rest continue, so
 * a cleanup error never aborts the others. The placeholder drop is SKIPPED when a reference-clear
 * phase threw - dropping it then would turn an empty placeholder into a dangling reference to a
 * deleted row; leaving it keeps the reference resolvable (to empty content) until a later retry.
 *
 * Returns `{ cleared, clearingFailed }` for the fork activity metadata. `clearingFailed` is true
 * when a reference-clear phase threw - placeholders were then NOT dropped - and `cleared` is 0 in
 * that case, so the report never claims references it did not actually clear. On success `cleared`
 * is the count of failed resources whose references were cleared.
 */
export async function clearFailedForkResourceReferences(params: {
  childWorkspaceId: string
  failures: ForkFailedResource[]
  /** Target workflows this sync deployed; their deployed versions are swept regardless of draft. */
  deployedTargetWorkflowIds?: string[]
  requestId?: string
}): Promise<{ cleared: number; clearingFailed: boolean }> {
  const { childWorkspaceId, failures, requestId = 'unknown' } = params
  if (failures.length === 0) return { cleared: 0, clearingFailed: false }

  const failedByKind = new Map<ForkRemapKind, Set<string>>()
  const markFailed = (kind: ForkRemapKind, id: string) => {
    const set = failedByKind.get(kind)
    if (set) set.add(id)
    else failedByKind.set(kind, new Set([id]))
  }
  const tableIds: string[] = []
  const kbIds: string[] = []
  // Standalone documents copied into an already-existing target KB (the doc-into-mapped-KB sync
  // path) - dropped individually, since their KB is not ours to remove.
  const docIds: string[] = []
  for (const failure of failures) {
    if (failure.kind === 'table') {
      markFailed('table', failure.childId)
      tableIds.push(failure.childId)
    } else if (failure.kind === 'knowledge-document') {
      markFailed('knowledge-document', failure.childId)
      docIds.push(failure.childId)
    } else if (failure.kind === 'file') {
      // A failed file blob: clear `file-upload` references to its copied storage key. No row to
      // drop - the metadata row is left in place so the user can re-upload the missing blob.
      markFailed('file', failure.childKey)
    } else {
      markFailed('knowledge-base', failure.childId)
      for (const docId of failure.documentChildIds) markFailed('knowledge-document', docId)
      kbIds.push(failure.childId)
    }
  }

  // Whether BOTH reference-clear phases completed without throwing. The placeholder drop below is
  // gated on this: if clearing threw, a workflow (draft or deployed version) may still reference
  // the failed id, so dropping its placeholder would create a dangling reference to a deleted row.
  let clearingSucceeded = true

  let affectedWorkflowIds: Set<string> = new Set()
  try {
    affectedWorkflowIds = await clearFailedReferencesInWorkflows(
      childWorkspaceId,
      failedByKind,
      requestId
    )
  } catch (error) {
    clearingSucceeded = false
    logger.error(`[${requestId}] Failed to clear references for failed fork resources`, {
      childWorkspaceId,
      error: getErrorMessage(error),
    })
  }

  // The same dead id also lives in DEPLOYED version states (the active one re-cut from the
  // placeholder-referencing draft at this sync's redeploy, plus any newer version from a rare
  // race), not only the draft just swept above. Sweep those too so "Load deployment" can't
  // re-poison the cleaned draft with a dropped id, and the execute path never runs against content
  // that no longer exists. Scope is the draft-affected workflows UNION this sync's deployed target
  // workflows: a deployed version may reference the placeholder even when the draft no longer does
  // (edited in the fill window), so draft divergence alone is not a reliable scope. Isolated: a
  // failure here never aborts a sibling resource's cleanup.
  const deployedSweepIds = new Set(affectedWorkflowIds)
  for (const id of params.deployedTargetWorkflowIds ?? []) deployedSweepIds.add(id)
  try {
    await clearFailedReferencesInDeploymentVersions(deployedSweepIds, failedByKind, requestId)
  } catch (error) {
    clearingSucceeded = false
    logger.error(`[${requestId}] Failed to clear references in fork deployment versions`, {
      childWorkspaceId,
      error: getErrorMessage(error),
    })
  }

  // Drop the orphaned placeholders. The KB delete cascades its documents + embeddings; the
  // table delete cascades its rows; a standalone document delete cascades its embeddings. Done
  // after the refs are cleared so a drop failure can't strand a workflow still pointing at the
  // (now content-less) resource - and ONLY when clearing succeeded, so a clear failure never
  // turns an empty placeholder into a dangling reference to a deleted row.
  if (!clearingSucceeded) {
    logger.warn(
      `[${requestId}] Skipping fork resource placeholder drop after a reference-clear failure`,
      {
        childWorkspaceId,
        tables: tableIds.length,
        knowledgeBases: kbIds.length,
        documents: docIds.length,
      }
    )
    return { cleared: 0, clearingFailed: true }
  }
  try {
    if (tableIds.length > 0) {
      await db.delete(userTableDefinitions).where(inArray(userTableDefinitions.id, tableIds))
    }
    if (kbIds.length > 0) {
      await db.delete(knowledgeBase).where(inArray(knowledgeBase.id, kbIds))
    }
    if (docIds.length > 0) {
      await db.delete(document).where(inArray(document.id, docIds))
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to drop orphaned fork resource placeholders`, {
      childWorkspaceId,
      error: getErrorMessage(error),
    })
  }

  return { cleared: failures.length, clearingFailed: false }
}

/**
 * Sweep the child workspace's workflow blocks and clear any subblock value (top-level selector
 * or nested tool param) that resolves to a failed child resource id. Reuses the create-mode
 * remap with an identity-or-clear resolver: a non-failed id resolves to itself (left unchanged),
 * a failed id resolves to null and is cleared, and its `dependsOn` children are cleared too.
 * Returns the ids of the workflows whose blocks actually had a reference cleared, so the deployed
 * version sweep can scope itself to exactly those workflows.
 */
export async function clearFailedReferencesInWorkflows(
  childWorkspaceId: string,
  failedByKind: Map<ForkRemapKind, Set<string>>,
  requestId: string
): Promise<Set<string>> {
  const resolve = buildFailedResolver(failedByKind)
  const affectedWorkflowIds = new Set<string>()

  let afterWorkflowId: string | null = null
  for (;;) {
    const workflowRows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(
        afterWorkflowId === null
          ? eq(workflow.workspaceId, childWorkspaceId)
          : and(eq(workflow.workspaceId, childWorkspaceId), gt(workflow.id, afterWorkflowId))
      )
      .orderBy(asc(workflow.id))
      .limit(WORKFLOW_PAGE)
    if (workflowRows.length === 0) break

    const workflowIds = workflowRows.map((row) => row.id)
    const blocks = await db
      .select({
        id: workflowBlocks.id,
        workflowId: workflowBlocks.workflowId,
        type: workflowBlocks.type,
        subBlocks: workflowBlocks.subBlocks,
      })
      .from(workflowBlocks)
      .where(inArray(workflowBlocks.workflowId, workflowIds))

    for (const block of blocks) {
      const current = (block.subBlocks ?? {}) as SubBlockRecord
      const { subBlocks: cleared, changed } = clearFailedSubBlockReferences(
        current,
        block.type,
        resolve
      )
      if (!changed) continue
      await db
        .update(workflowBlocks)
        .set({ subBlocks: cleared })
        .where(eq(workflowBlocks.id, block.id))
      affectedWorkflowIds.add(block.workflowId)
    }

    if (workflowRows.length < WORKFLOW_PAGE) break
    afterWorkflowId = workflowIds[workflowIds.length - 1]
  }

  return affectedWorkflowIds
}

/**
 * Rewrite a deployment version's serialized state in memory, clearing every block subblock that
 * resolves to a failed id (and its `dependsOn` children). Returns `changed: false` with the
 * original state when no block referenced a failed id - so a version cut before this sync, which
 * cannot contain the new placeholder id, is a no-op and never written back. Tolerant of a
 * malformed/legacy state shape (anything that is not `{ blocks: {...} }` is left untouched).
 */
export function rewriteDeploymentVersionState(
  state: unknown,
  resolve: ForkCopyResolver
): { state: unknown; changed: boolean } {
  if (!isRecord(state) || !isRecord(state.blocks)) return { state, changed: false }

  let nextBlocks: Record<string, unknown> | null = null
  for (const [blockId, block] of Object.entries(state.blocks)) {
    if (!isRecord(block)) continue
    const blockType = typeof block.type === 'string' ? block.type : undefined
    if (!blockType || !isRecord(block.subBlocks)) continue
    const { subBlocks: cleared, changed } = clearFailedSubBlockReferences(
      block.subBlocks as SubBlockRecord,
      blockType,
      resolve
    )
    if (!changed) continue
    nextBlocks ??= { ...state.blocks }
    nextBlocks[blockId] = { ...block, subBlocks: cleared }
  }

  if (!nextBlocks) return { state, changed: false }
  return { state: { ...state, blocks: nextBlocks }, changed: true }
}

/**
 * Rewrite the DEPLOYED version states of the workflows whose draft blocks were just swept. The dead
 * placeholder id lives in any version re-cut from the (placeholder-referencing) draft at this sync's
 * redeploy - in practice the active one - so it must be cleared there too, not only in the draft.
 * Every version of each affected workflow is examined, but only versions whose state actually
 * changes are written: an older version predates the sync and cannot contain the new id, so it is a
 * no-op. After a version is rewritten its cached deployed state is evicted so execute/serve rebuilds
 * from the cleaned snapshot. Bounded work (no long transaction): per-version short UPDATEs, versions
 * keyset-paginated, and a per-workflow failure is logged without aborting the other workflows.
 */
export async function clearFailedReferencesInDeploymentVersions(
  workflowIds: ReadonlySet<string>,
  failedByKind: Map<ForkRemapKind, Set<string>>,
  requestId: string
): Promise<void> {
  if (workflowIds.size === 0) return
  const resolve = buildFailedResolver(failedByKind)

  for (const workflowId of workflowIds) {
    try {
      let afterVersion: number | null = null
      for (;;) {
        const versions = await db
          .select({
            id: workflowDeploymentVersion.id,
            version: workflowDeploymentVersion.version,
            state: workflowDeploymentVersion.state,
          })
          .from(workflowDeploymentVersion)
          .where(
            afterVersion === null
              ? eq(workflowDeploymentVersion.workflowId, workflowId)
              : and(
                  eq(workflowDeploymentVersion.workflowId, workflowId),
                  gt(workflowDeploymentVersion.version, afterVersion)
                )
          )
          .orderBy(asc(workflowDeploymentVersion.version))
          .limit(DEPLOYMENT_VERSION_PAGE)
        if (versions.length === 0) break

        for (const version of versions) {
          const { state: nextState, changed } = rewriteDeploymentVersionState(
            version.state,
            resolve
          )
          if (!changed) continue
          await db
            .update(workflowDeploymentVersion)
            .set({ state: nextState })
            .where(eq(workflowDeploymentVersion.id, version.id))
          // Evict the post-migration deployed state cached by this immutable version id so the
          // execute/serve path rebuilds from the cleaned snapshot.
          invalidateDeployedStateCache(version.id)
        }

        if (versions.length < DEPLOYMENT_VERSION_PAGE) break
        afterVersion = versions[versions.length - 1].version
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to clear references in deployment versions`, {
        workflowId,
        error: getErrorMessage(error),
      })
    }
  }
}
