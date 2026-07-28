import { filterUndefined } from '@sim/utils/object'
import type { BlockState, SubBlockState } from '@sim/workflow-types/workflow'

export const DEFAULT_SUBBLOCK_TYPE = 'short-input'

/**
 * Merges subblock values into the provided subblock structures.
 * Falls back to a default subblock shape when a value has no structure.
 * @param subBlocks - Existing subblock definitions from the workflow
 * @param values - Stored subblock values keyed by subblock id
 * @returns Merged subblock structures with updated values
 */
export function mergeSubBlockValues(
  subBlocks: Record<string, unknown> | undefined,
  values: Record<string, unknown> | undefined
): Record<string, unknown> {
  const merged = { ...(subBlocks || {}) } as Record<string, any>

  if (!values) return merged

  Object.entries(values).forEach(([subBlockId, value]) => {
    if (merged[subBlockId] && typeof merged[subBlockId] === 'object') {
      merged[subBlockId] = {
        ...(merged[subBlockId] as Record<string, unknown>),
        value,
      }
      return
    }

    merged[subBlockId] = {
      id: subBlockId,
      type: DEFAULT_SUBBLOCK_TYPE,
      value,
    }
  })

  return merged
}

/**
 * Merges workflow block states with explicit subblock values while maintaining block structure.
 *
 * A value that is present in the map overrides the structure's value — including `null`,
 * which represents an explicitly cleared field. The block structure's own copy of a value
 * can be stale (it is only rewritten on hydration, while edits land in the values map), so
 * skipping nulls here would resurrect the pre-clear value and make the merged state diverge
 * from what is actually persisted.
 *
 * Two softening rules keep sparse maps safe:
 * - `undefined` is treated as "no value recorded" and never overrides the structure.
 * - `null` never creates an entry for a subblock missing from the structure; only non-null
 *   structure-less values (e.g. runtime ids like `webhookId`/`triggerPath`) are added, with
 *   a minimal default shape, so they survive serialization.
 *
 * @param blocks - Block configurations from workflow state
 * @param subBlockValues - Subblock values keyed by blockId -> subBlockId -> value
 * @param blockId - Optional specific block ID to merge (merges all if not provided)
 * @returns Merged block states with updated subblocks
 */
export function mergeSubblockStateWithValues(
  blocks: Record<string, BlockState>,
  subBlockValues: Record<string, Record<string, unknown>> = {},
  blockId?: string
): Record<string, BlockState> {
  const blocksToProcess = blockId ? { [blockId]: blocks[blockId] } : blocks

  return Object.entries(blocksToProcess).reduce(
    (acc, [id, block]) => {
      if (!block) {
        return acc
      }

      const blockSubBlocks = block.subBlocks || {}
      const definedValues = filterUndefined(subBlockValues[id] || {})
      const mergeableValues = Object.fromEntries(
        Object.entries(definedValues).filter(
          ([subBlockId, value]) => value !== null || Object.hasOwn(blockSubBlocks, subBlockId)
        )
      )

      const mergedSubBlocks = mergeSubBlockValues(blockSubBlocks, mergeableValues) as Record<
        string,
        SubBlockState
      >

      acc[id] = {
        ...block,
        subBlocks: mergedSubBlocks,
      }

      return acc
    },
    {} as Record<string, BlockState>
  )
}
