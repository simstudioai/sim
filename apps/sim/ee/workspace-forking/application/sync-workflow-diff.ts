import { db } from '@sim/db'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  remapVariableIdsInSubBlocks,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import {
  defineForkUseCase,
  type ForkApplicationContext,
} from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import {
  loadSourceDeployedStates,
  loadTargetDraftState,
} from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { loadForkBlockMap } from '@/ee/workspace-forking/lib/mapping/block-map-store'
import { computeForkPromotePlan } from '@/ee/workspace-forking/lib/promote/promote-plan'
import { buildForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import { remapWorkflowStateBlockIds } from '@/ee/workspace-forking/lib/remap/remap-state-block-ids'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'

/** Names carried by exactly one variable on a side, so a name can stand in for an id. */
function uniqueNames(variables: Record<string, Variable> | undefined): Map<string, string> {
  const counts = new Map<string, number>()
  for (const variable of Object.values(variables ?? {})) {
    counts.set(variable.name, (counts.get(variable.name) ?? 0) + 1)
  }
  const out = new Map<string, string>()
  for (const variable of Object.values(variables ?? {})) {
    if (counts.get(variable.name) === 1) out.set(variable.name, variable.id)
  }
  return out
}

/**
 * A sync gives every copied variable a fresh id and rewrites the references
 * inside Variables blocks to match, so the target's variables never share ids
 * with the source's. The comparison keys variables by id; re-key the source
 * side to the target's ids by name, definitions and references alike, so a
 * variable that exists on both sides compares as itself rather than as one
 * removed and one added. A name that is not unique on both sides keeps its
 * source id, since it could not be paired honestly.
 */
function alignVariableIds(after: WorkflowState, before: WorkflowState | null): WorkflowState {
  if (!before?.variables || !after.variables) return after
  const targetIdByName = uniqueNames(before.variables)
  const sourceIdByName = uniqueNames(after.variables)
  const idMap = new Map<string, string>()
  for (const [name, sourceId] of sourceIdByName) {
    const targetId = targetIdByName.get(name)
    if (targetId && targetId !== sourceId) idMap.set(sourceId, targetId)
  }
  if (idMap.size === 0) return after

  const variables: Record<string, Variable> = {}
  for (const variable of Object.values(after.variables)) {
    const id = idMap.get(variable.id) ?? variable.id
    variables[id] = { ...variable, id }
  }
  const blocks: WorkflowState['blocks'] = {}
  for (const [id, block] of Object.entries(after.blocks)) {
    try {
      // double-cast-allowed: SubBlockRecord is the persistence view of the same sub-block map
      const remapped = remapVariableIdsInSubBlocks(
        (block.subBlocks ?? {}) as unknown as SubBlockRecord,
        idMap
      )
      // double-cast-allowed: back from the persistence view to the canvas state's sub-block map
      blocks[id] = {
        ...block,
        subBlocks: remapped as unknown as WorkflowState['blocks'][string]['subBlocks'],
      }
    } catch {
      /* An assignments value the remap cannot parse is shown as stored. */
      blocks[id] = block
    }
  }
  return { ...after, blocks, variables }
}

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
 * block ids (`after`). The plan and the block-id pairing are resolved exactly
 * as the promote would resolve them.
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

    /* A create has no target yet, and its plan id is provisional, so neither is reported. */
    let before: WorkflowState | null = null
    if (item.mode === 'replace') {
      before = await loadTargetDraftState(item.targetWorkflowId, targetWorkspaceId)
      if (!before) {
        throw new OrchestrationError('not_found', 'The target workflow could not be loaded')
      }
    }

    const sourceName = item.sourceMeta.name
    const targetName = item.targetName ?? sourceName
    return {
      targetWorkflowId: item.mode === 'replace' ? item.targetWorkflowId : null,
      before,
      after: alignVariableIds(after, before),
      beforeLabel: `${targetName} (current)`,
      afterLabel: `${sourceName} (deployed)`,
    }
  },
})
