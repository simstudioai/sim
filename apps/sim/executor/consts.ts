/**
 * Enum defining all supported block types in the executor.
 * This centralizes block type definitions and eliminates magic strings.
 */
export enum BlockType {
  PARALLEL = 'parallel',
  LOOP = 'loop',
  ROUTER = 'router',
  CONDITION = 'condition',
  FUNCTION = 'function',
  AGENT = 'agent',
  API = 'api',
  EVALUATOR = 'evaluator',
  RESPONSE = 'response',
  WORKFLOW = 'workflow',
  STARTER = 'starter',
}

/**
 * Array of all block types for iteration and validation
 */
export const ALL_BLOCK_TYPES = Object.values(BlockType) as string[]

/**
 * Type guard to check if a string is a valid block type
 */
export function isValidBlockType(type: string): type is BlockType {
  return ALL_BLOCK_TYPES.includes(type)
}
