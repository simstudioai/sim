import { db } from '@sim/db'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  defineForkUseCase,
  type ForkApplicationContext,
} from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import {
  loadSourceDeployedWorkflow,
  loadTargetDraftState,
} from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { loadForkBlockMap } from '@/ee/workspace-forking/lib/mapping/block-map-store'
import { resolveForkPlanItem } from '@/ee/workspace-forking/lib/promote/promote-plan'
import { projectSyncSource } from '@/ee/workspace-forking/lib/promote/sync-preview'
import { buildForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'

interface SyncWorkflowDiffInput {
  workspaceId: string
  otherWorkspaceId: string
  direction: 'push' | 'pull'
  sourceWorkflowId: string
}

/**
 * Block-level preview of ONE workflow in a sync: the target as its editor
 * holds it (`before`: the draft the sync overwrites, null when the sync would
 * create the workflow) and the source's deployment re-keyed to the target's
 * block ids (`after`). The plan item and the block-id pairing are resolved
 * exactly as the promote would resolve them, reading only this workflow's
 * state, identity mapping and block pairs, so a preview costs the same in a
 * workspace of five workflows as in one of five hundred.
 *
 * Both states carry their raw sub-block values, on par with the deployment
 * version route the same session UI already reads; the caller holds admin on
 * both workspaces (`bothSides`). `after` is the source re-keyed only: the
 * resource remaps, custom block replacements and stored dependent values the
 * sync applies at write time are shown by the sync page's own sections, and a
 * reference the sync would clear blocks the sync until it is dropped there.
 */
export const getWorkspaceSyncWorkflowDiff = defineForkUseCase({
  operation: forkOperations.syncPreview,
  bothSides: true,
  edge: true,
  async execute({
    input,
    context,
  }: {
    input: SyncWorkflowDiffInput
    context: ForkApplicationContext
  }) {
    const { workspaceId: id, direction, sourceWorkflowId } = input
    const edge = context.edge!
    const sourceWorkspaceId = direction === 'push' ? id : input.otherWorkspaceId
    const targetWorkspaceId = direction === 'push' ? input.otherWorkspaceId : id

    const source = await loadSourceDeployedWorkflow(sourceWorkspaceId, sourceWorkflowId)
    const item = source
      ? await resolveForkPlanItem({
          executor: db,
          edge,
          sourceWorkspaceId,
          targetWorkspaceId,
          source: source.summary,
        })
      : null
    if (!source || !item) {
      throw new OrchestrationError('not_found', 'That workflow is not part of this sync')
    }

    /*
     * A create has no target yet and its plan id is provisional, so there is no
     * `before`, no recorded block pairs (every id derives) and no id to report.
     */
    const sourceIsParent = sourceWorkspaceId === edge.parentWorkspaceId
    const [blockMap, before] =
      item.mode === 'replace'
        ? await Promise.all([
            loadForkBlockMap(db, edge.childWorkspaceId, {
              side: sourceIsParent ? 'child' : 'parent',
              workflowId: item.targetWorkflowId,
            }),
            loadTargetDraftState(item.targetWorkflowId, targetWorkspaceId),
          ])
        : [{ parentToChild: new Map(), childToParent: new Map() }, null]
    if (item.mode === 'replace' && !before) {
      throw new OrchestrationError('not_found', 'The target workflow could not be loaded')
    }
    const after = projectSyncSource(
      source.state,
      before,
      item.targetWorkflowId,
      buildForkBlockIdResolver(sourceIsParent, blockMap)
    )

    const sourceName = item.sourceMeta.name
    const targetName = item.targetName ?? sourceName
    return {
      targetWorkflowId: item.mode === 'replace' ? item.targetWorkflowId : null,
      before,
      after,
      beforeLabel: `${targetName} (current)`,
      afterLabel: `${sourceName} (deployed)`,
    }
  },
})
