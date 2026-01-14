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
