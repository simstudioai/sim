import type { BlockState, SubBlockState } from '@/stores/workflows/workflow/types'

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
 * Values that are null or undefined do not override existing subblock values.
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
      const blockValues = subBlockValues[id] || {}
      const filteredValues = Object.fromEntries(
        Object.entries(blockValues).filter(([, value]) => value !== null && value !== undefined)
      )

      const mergedSubBlocks = mergeSubBlockValues(blockSubBlocks, filteredValues) as Record<
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
