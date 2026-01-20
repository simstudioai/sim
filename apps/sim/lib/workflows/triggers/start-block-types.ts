/**
 * Valid start block types that can trigger a workflow
 * This module is kept lightweight with no dependencies to avoid circular imports
 */
export const VALID_START_BLOCK_TYPES = [
  'starter',
  'start',
  'start_trigger',
  'api',
  'api_trigger',
  'input_trigger',
] as const

export type ValidStartBlockType = (typeof VALID_START_BLOCK_TYPES)[number]

/**
 * Check if a block type is a valid start block type
 */
export function isValidStartBlockType(blockType: string): blockType is ValidStartBlockType {
  return VALID_START_BLOCK_TYPES.includes(blockType as ValidStartBlockType)
}
