import { generateId } from '@sim/utils/id'
import type { MaterializeHooks } from '@sim/workflow-code'
import type { BlockState } from '@sim/workflow-types/workflow'
import { getEffectiveBlockOutputs } from '@/lib/workflows/blocks/outputs'
import { createBlockFromParams } from '@/lib/workflows/editing/builders'
import { hasTriggerCapability } from '@/lib/workflows/triggers/utils'
import { getBlock } from '@/blocks/registry'

/** Trigger mode counts for outputs only on a block that can host triggers (builders.ts). */
function effectiveTriggerMode(block: Pick<BlockState, 'type' | 'triggerMode'>): boolean {
  const config = getBlock(block.type)
  return block.triggerMode === true && config !== undefined && hasTriggerCapability(config)
}

/**
 * The server callbacks `materialize` needs (contract `MaterializeHooks`):
 * - `initBlock` creates a block exactly as the editing engine adds one (`createBlockFromParams`),
 *   so a block written from code starts with the editor's subBlock entries, types, modes and
 *   layout defaults;
 * - `computeOutputs` derives stored outputs the way the editing engine does
 *   (`getEffectiveBlockOutputs`);
 * - `newId` is `generateId`.
 */
export function createMaterializeHooks(): MaterializeHooks {
  return {
    initBlock: ({ id, type, name, triggerMode }) => {
      const block: BlockState = createBlockFromParams(id, { type, name, triggerMode })
      return block
    },
    computeOutputs: (block) => {
      const triggerMode = effectiveTriggerMode(block)
      return getEffectiveBlockOutputs(block.type, block.subBlocks, {
        triggerMode,
        preferToolOutputs: !triggerMode,
      })
    },
    newId: generateId,
  }
}
