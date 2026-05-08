const SYNTHETIC_TOOL_SUBBLOCK_RE = /-tool-\d+-/

/**
 * Returns true for ToolSubBlockRenderer mirror subblocks.
 *
 * These IDs follow `{subBlockId}-tool-{index}-{paramId}` and duplicate values
 * already stored in the aggregate `tool-input` subblock.
 */
export function isSyntheticToolSubBlockId(subBlockId: string): boolean {
  return SYNTHETIC_TOOL_SUBBLOCK_RE.test(subBlockId)
}
