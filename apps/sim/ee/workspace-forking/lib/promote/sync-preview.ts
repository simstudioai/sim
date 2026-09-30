import { createLogger } from '@sim/logger'
import { generateWorkflowDiffSummary, omitPresentationChanges } from '@/lib/workflows/comparison'
import {
  remapVariableIdsInSubBlocks,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import {
  forEachTargetDraft,
  MAX_FORK_STATE_BYTES,
  measureTargetDraftBytes,
} from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import type { ForkPromotePlanItem } from '@/ee/workspace-forking/lib/promote/promote-plan'
import type { ForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import { remapWorkflowStateBlockIds } from '@/ee/workspace-forking/lib/remap/remap-state-block-ids'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkspaceForkSyncPreview')

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
      const sourceSubBlocks = (block.subBlocks ?? {}) as unknown as SubBlockRecord
      const remapped = remapVariableIdsInSubBlocks(sourceSubBlocks, idMap)
      // double-cast-allowed: back from the persistence view to the canvas state's sub-block map
      const subBlocks = remapped as unknown as WorkflowState['blocks'][string]['subBlocks']
      blocks[id] = { ...block, subBlocks }
    } catch {
      /* An assignments value the remap cannot parse is shown as stored. */
      blocks[id] = block
    }
  }
  return { ...after, blocks, variables }
}

/**
 * The source's deployed state in the target's terms: block ids re-keyed the way
 * the promote re-keys them, then variables re-keyed to the target's by name.
 * This is what a sync preview compares against the target's draft (`before`,
 * null when the sync would create the workflow).
 */
export function projectSyncSource(
  sourceState: WorkflowState,
  before: WorkflowState | null,
  targetWorkflowId: string,
  resolveBlockId: ForkBlockIdResolver
): WorkflowState {
  const after = remapWorkflowStateBlockIds(sourceState, (blockId) =>
    resolveBlockId(targetWorkflowId, blockId)
  )
  return alignVariableIds(after, before)
}

/**
 * Whether syncing would change what the target's editor holds, by the same rule
 * the comparison view uses to say "No changes". A workflow the sync creates
 * always changes.
 */
export function syncChangesWorkflow(before: WorkflowState | null, after: WorkflowState): boolean {
  if (!before) return true
  return omitPresentationChanges(generateWorkflowDiffSummary(after, before)).hasChanges
}

/**
 * The source workflows a sync would replace without changing anything in the
 * target's draft, so their rows need no comparison. Drafts are read a few at a
 * time and dropped after comparing. When the drafts together exceed the fork
 * state limit, none are read and every workflow counts as changed: the rows
 * then all offer a comparison, which is the safe way to be wrong.
 */
export async function listUnchangedSyncSources(params: {
  items: ForkPromotePlanItem[]
  sourceStates: ReadonlyMap<string, WorkflowState>
  targetWorkspaceId: string
  resolveBlockId: ForkBlockIdResolver
}): Promise<Set<string>> {
  const { items, sourceStates, targetWorkspaceId, resolveBlockId } = params
  const unchanged = new Set<string>()
  const replaced = items.filter(
    (item) => item.mode === 'replace' && sourceStates.has(item.sourceWorkflowId)
  )
  if (replaced.length === 0) return unchanged
  const targetIds = replaced.map((item) => item.targetWorkflowId)
  const bytes = await measureTargetDraftBytes(targetIds)
  if (bytes > MAX_FORK_STATE_BYTES) {
    logger.info('Skipping per-workflow change check: target drafts exceed the fork state limit', {
      workflows: targetIds.length,
      bytes,
    })
    return unchanged
  }
  const itemByTarget = new Map(replaced.map((item) => [item.targetWorkflowId, item]))
  await forEachTargetDraft(targetIds, targetWorkspaceId, (targetWorkflowId, before) => {
    const item = itemByTarget.get(targetWorkflowId)
    const sourceState = item && sourceStates.get(item.sourceWorkflowId)
    if (!item || !sourceState) return
    const after = projectSyncSource(sourceState, before, targetWorkflowId, resolveBlockId)
    if (!syncChangesWorkflow(before, after)) unchanged.add(item.sourceWorkflowId)
  })
  return unchanged
}
