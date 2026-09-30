import { db } from '@sim/db'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  defineForkUseCase,
  type ForkApplicationContext,
} from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import {
  loadSourceDeployedStates,
  loadTargetDraftState,
  readDeployedState,
} from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { loadForkBlockMap } from '@/ee/workspace-forking/lib/mapping/block-map-store'
import { computeForkPromotePlan } from '@/ee/workspace-forking/lib/promote/promote-plan'
import { buildForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import { remapWorkflowStateBlockIds } from '@/ee/workspace-forking/lib/remap/remap-state-block-ids'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * A sync gives every copied variable a fresh id, so the target's variables never
 * share ids with the source's. The comparison keys variables by id; re-key the
 * source side to the target's ids by name so a variable that exists on both
 * sides compares as itself rather than as one removed and one added.
 */
function alignVariableIds(after: WorkflowState, before: WorkflowState | null): WorkflowState {
  if (!before?.variables || !after.variables) return after
  const idByName = new Map(
    Object.values(before.variables).map((variable) => [variable.name, variable.id] as const)
  )
  const variables: Record<string, Variable> = {}
  for (const variable of Object.values(after.variables)) {
    const id = idByName.get(variable.name) ?? variable.id
    variables[id] = { ...variable, id }
  }
  return { ...after, variables }
}

interface SyncWorkflowDiffInput {
  workspaceId: string
  otherWorkspaceId: string
  direction: 'push' | 'pull'
  sourceWorkflowId: string
}

/**
 * Block-level preview of ONE workflow in a sync: the target as its editor
 * holds it (`before`: the draft the sync overwrites, else its live deployment,
 * null when the sync would create the workflow) and the source's deployment
 * re-keyed to the target's block ids (`after`). The plan and the block-id
 * pairing are resolved exactly as the promote would resolve them.
 *
 * Both states carry their raw sub-block values, on par with the deployment
 * version route the same session UI already reads; the caller holds admin on
 * both workspaces (`bothSides`). `after` is the source re-keyed only: the
 * resource remaps, custom block replacements and stored dependent values the
 * sync applies at write time are shown by the sync page's own sections.
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

    const [{ deployedWorkflows, sourceStates }, blockMap] = await Promise.all([
      loadSourceDeployedStates(sourceWorkspaceId),
      loadForkBlockMap(db, edge.childWorkspaceId),
    ])
    const plan = await computeForkPromotePlan({
      executor: db,
      edge,
      sourceWorkspaceId,
      targetWorkspaceId,
      direction,
      deployedSourceWorkflows: deployedWorkflows,
      sourceStates,
    })

    const item = plan.items.find((candidate) => candidate.sourceWorkflowId === sourceWorkflowId)
    const sourceState = sourceStates.get(sourceWorkflowId)
    if (!item || !sourceState) {
      throw new OrchestrationError('not_found', 'That workflow is not part of this sync')
    }

    const sourceIsParent = sourceWorkspaceId === edge.parentWorkspaceId
    const resolveBlockId = buildForkBlockIdResolver(sourceIsParent, blockMap)
    const after = remapWorkflowStateBlockIds(sourceState, (blockId) =>
      resolveBlockId(item.targetWorkflowId, blockId)
    )

    let before: WorkflowState | null = null
    if (item.mode === 'replace') {
      before =
        (await loadTargetDraftState(item.targetWorkflowId)) ??
        (await readDeployedState(item.targetWorkflowId, targetWorkspaceId))
    }

    const sourceName = item.sourceMeta.name
    const targetName = item.targetName ?? sourceName
    return {
      targetWorkflowId: item.targetWorkflowId,
      before,
      after: alignVariableIds(after, before),
      beforeLabel: `${targetName} (current)`,
      afterLabel: `${sourceName} (deployed)`,
    }
  },
})
