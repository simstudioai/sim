import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import { resolveCustomBlockToolBinding } from '@/lib/workflows/custom-blocks/operations'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import type { ForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import {
  customBlockInputStorageKey,
  type ForkReferenceResolver,
} from '@/ee/workspace-forking/lib/remap/remap-references'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('ForkCustomBlockReconfigs')

interface CustomBlockReconfigItem {
  sourceWorkflowId: string
  targetWorkflowId: string
}

export interface CollectForkCustomBlockReconfigsParams {
  items: CustomBlockReconfigItem[]
  sourceStates: Map<string, WorkflowState>
  resolveTargetBlockId: ForkBlockIdResolver
  /** The promote resolver, to find each placed custom block's mapped target type. */
  resolve: ForkReferenceResolver
  /** The TARGET workspace, which scopes the org the target block is resolved in. */
  targetWorkspaceId: string
}

/**
 * The reconfigurable inputs of every custom block this sync REPOINTS at a different block.
 *
 * A credential/KB/table swap invalidates the `dependsOn` fields scoped to it. Repointing a
 * custom block is the same idea taken to its limit: the block's inputs are keyed by the SOURCE
 * block's Start field ids, so after the swap NONE of them describe a field the new block has —
 * every input is reconfigurable, not a subset. They are emitted through the same
 * {@link ForkDependentReconfig} channel so they store, pre-fill, gate Sync, and apply exactly
 * like a re-picked Gmail label does.
 *
 * `parentKind`/`parentSourceId` are the block itself (`custom-block` + the SOURCE type), which
 * is precisely the key the mapping entry is joined on — so the fields render under their own
 * mapping row with no extra wiring.
 *
 * A block whose type does NOT change is skipped: its field ids still describe it, so its values
 * carry across untouched and there is nothing to re-pick.
 */
export async function collectForkCustomBlockReconfigs(
  params: CollectForkCustomBlockReconfigsParams
): Promise<ForkDependentReconfig[]> {
  const { items, sourceStates, resolveTargetBlockId, resolve, targetWorkspaceId } = params

  /** Source type -> target type, for every placed custom block this sync repoints. */
  const swaps: Array<{
    targetWorkflowId: string
    targetBlockId: string
    blockName: string
    sourceType: string
    targetType: string
  }> = []

  for (const item of items) {
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    for (const [sourceBlockId, block] of Object.entries(state.blocks)) {
      if (!isCustomBlockType(block.type)) continue
      const targetType = resolve('custom-block', block.type)
      if (!targetType || targetType === block.type) continue
      swaps.push({
        targetWorkflowId: item.targetWorkflowId,
        targetBlockId: resolveTargetBlockId(item.targetWorkflowId, sourceBlockId),
        blockName: block.name,
        sourceType: block.type,
        targetType,
      })
    }
  }
  if (swaps.length === 0) return []

  // One binding lookup per distinct TARGET type, not per placement: the same block placed in
  // five workflows resolves the same input schema every time.
  const bindingByType = new Map<string, Awaited<ReturnType<typeof resolveCustomBlockToolBinding>>>()
  for (const targetType of new Set(swaps.map((swap) => swap.targetType))) {
    try {
      bindingByType.set(
        targetType,
        await resolveCustomBlockToolBinding(targetType, targetWorkspaceId)
      )
    } catch (error) {
      // A target that will not resolve is already a sync blocker via the mapping's own
      // existence check; failing the whole diff over it would hide every other finding.
      logger.warn('Could not resolve a mapped custom block; its inputs are not offered', {
        error: getErrorMessage(error),
      })
      bindingByType.set(targetType, null)
    }
  }

  const out: ForkDependentReconfig[] = []
  for (const swap of swaps) {
    const binding = bindingByType.get(swap.targetType)
    if (!binding) continue
    for (const field of binding.inputFields) {
      // The canvas keys a custom block's sub-blocks by the field's stable id, falling back to
      // its name for legacy fields with none. The STORAGE key namespaces that by the target
      // type and field type, so re-pointing the block again cannot reuse this target's values
      // and the apply side can restore a boolean's real type — see
      // `customBlockInputStorageKey`.
      const fieldId = field.id ?? field.name
      const subBlockKey = customBlockInputStorageKey(swap.targetType, field.type, fieldId)
      out.push({
        parentKind: 'custom-block',
        parentSourceId: swap.sourceType,
        targetWorkflowId: swap.targetWorkflowId,
        targetBlockId: swap.targetBlockId,
        blockName: swap.blockName,
        subBlockKey,
        title: field.name,
        fieldType: field.type,
        // The source's value is never a sensible seed here: it belongs to a different block's
        // field of the same position, so pre-filling it would silently carry a value meaning
        // something else. The diff overlays the stored value on top of this.
        currentValue: '',
        sourceValue: '',
        required: binding.requiredInputIds.includes(fieldId),
        consumesContextKeys: [],
        context: {},
      })
    }
  }
  return out
}
