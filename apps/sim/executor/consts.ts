/**
 * Central constants and types for the executor
 *
 * Consolidates all magic strings, block types, edge handles, and type definitions
 * used throughout the executor to eliminate duplication and improve type safety.
 */

/**
 * Block types
 */
export enum BlockType {
  // Control flow
  PARALLEL = 'parallel',
  LOOP = 'loop',
  ROUTER = 'router',
  CONDITION = 'condition',

  // Triggers
  START_TRIGGER = 'start_trigger',
  STARTER = 'starter',
  TRIGGER = 'trigger',

  // Data processing
  FUNCTION = 'function',
  AGENT = 'agent',
  API = 'api',
  EVALUATOR = 'evaluator',
  VARIABLES = 'variables',

  // I/O
  RESPONSE = 'response',
  WORKFLOW = 'workflow',
  WORKFLOW_INPUT = 'workflow_input',

  // Utilities
  WAIT = 'wait',

  // Infrastructure (virtual blocks)
  SENTINEL_START = 'sentinel_start',
  SENTINEL_END = 'sentinel_end',
}

/**
 * Trigger block types (blocks that can start a workflow)
 */
export const TRIGGER_BLOCK_TYPES = [
  BlockType.START_TRIGGER,
  BlockType.STARTER,
  BlockType.TRIGGER,
] as const

/**
 * Metadata-only block types (not executable, just configuration)
 */
export const METADATA_ONLY_BLOCK_TYPES = [BlockType.LOOP, BlockType.PARALLEL] as const

/**
 * Loop types
 */
export type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'

/**
 * Sentinel types
 */
export type SentinelType = 'start' | 'end'

/**
 * Parallel types
 */
export type ParallelType = 'collection' | 'count'

/**
 * Edge handles for routing block outputs
 */
export const EDGE_HANDLE = {
  // Condition block outputs
  CONDITION_TRUE: 'condition-true',
  CONDITION_FALSE: 'condition-false',
  CONDITION_PREFIX: 'condition-',

  // Router block outputs
  ROUTER_PREFIX: 'router-',
  ROUTER_DEFAULT: 'default',

  // Loop sentinel outputs
  LOOP_CONTINUE: 'loop_continue',
  LOOP_CONTINUE_ALT: 'loop-continue-source', // Alternative handle name
  LOOP_EXIT: 'loop_exit',

  // Error handling
  ERROR: 'error',

  // Default/fallback
  SOURCE: 'source',
  DEFAULT: 'default',
} as const

/**
 * Edge handle naming conventions
 */
export const EDGE = {
  CONDITION_PREFIX: 'condition-',
  ROUTER_PREFIX: 'router-',
  LOOP_CONTINUE: 'loop_continue',
  LOOP_CONTINUE_ALT: 'loop-continue-source',
  LOOP_EXIT: 'loop_exit',
  ERROR: 'error',
  SOURCE: 'source',
  DEFAULT: 'default',
} as const

/**
 * Loop configuration
 */
export const LOOP = {
  // Loop types
  TYPE: {
    FOR: 'for' as LoopType,
    FOR_EACH: 'forEach' as LoopType,
    WHILE: 'while' as LoopType,
    DO_WHILE: 'doWhile',
  },

  // Sentinel node naming
  SENTINEL: {
    PREFIX: 'loop-',
    START_SUFFIX: '-sentinel-start',
    END_SUFFIX: '-sentinel-end',
    START_TYPE: 'start' as SentinelType,
    END_TYPE: 'end' as SentinelType,
  },
} as const

/**
 * Parallel configuration
 */
export const PARALLEL = {
  // Parallel types
  TYPE: {
    COLLECTION: 'collection' as ParallelType,
    COUNT: 'count' as ParallelType,
  },

  // Branch notation
  BRANCH: {
    PREFIX: '₍',
    SUFFIX: '₎',
  },

  // Default values
  DEFAULT_COUNT: 1,
} as const

/**
 * Reference syntax for variable resolution
 */
export const REFERENCE = {
  // Reference delimiters
  START: '<',
  END: '>',
  PATH_DELIMITER: '.',

  // Environment variable syntax
  ENV_VAR_START: '{{',
  ENV_VAR_END: '}}',

  // Reference prefixes
  PREFIX: {
    LOOP: 'loop',
    PARALLEL: 'parallel',
    VARIABLE: 'variable',
  },
} as const

/**
 * Loop reference fields
 */
export const LOOP_REFERENCE = {
  ITERATION: 'iteration',
  INDEX: 'index',
  ITEM: 'item',
} as const

/**
 * Parallel reference fields
 */
export const PARALLEL_REFERENCE = {
  INDEX: 'index',
  CURRENT_ITEM: 'currentItem',
  ITEMS: 'items',
} as const

/**
 * Default/fallback values
 */
export const DEFAULTS = {
  BLOCK_TYPE: 'unknown',
  MAX_LOOP_ITERATIONS: 1000,
  EXECUTION_TIME: 0,
} as const

/**
 * Condition configuration
 */
export interface ConditionConfig {
  id: string
  label?: string
  condition: string
}

/**
 * Type guards
 */
export function isTriggerBlockType(blockType: string | undefined): boolean {
  return TRIGGER_BLOCK_TYPES.includes(blockType as any)
}

export function isMetadataOnlyBlockType(blockType: string | undefined): boolean {
  return METADATA_ONLY_BLOCK_TYPES.includes(blockType as any)
}

export function isWorkflowBlockType(blockType: string | undefined): boolean {
  return blockType === BlockType.WORKFLOW || blockType === BlockType.WORKFLOW_INPUT
}

export function isSentinelBlockType(blockType: string | undefined): boolean {
  return blockType === BlockType.SENTINEL_START || blockType === BlockType.SENTINEL_END
}

export function isConditionBlockType(blockType: string | undefined): boolean {
  return blockType === BlockType.CONDITION
}

export function isRouterBlockType(blockType: string | undefined): boolean {
  return blockType === BlockType.ROUTER
}
