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

export const EDGE = {
  CONDITION_PREFIX: 'condition-',
  CONDITION_TRUE: 'condition-true',
  CONDITION_FALSE: 'condition-false',
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
  START: '<',
  END: '>',
  PATH_DELIMITER: '.',
  ENV_VAR_START: '{{',
  ENV_VAR_END: '}}',
  PREFIX: {
    LOOP: 'loop',
    PARALLEL: 'parallel',
    VARIABLE: 'variable',
  },
} as const

export const SPECIAL_REFERENCE_PREFIXES = [
  REFERENCE.PREFIX.LOOP,
  REFERENCE.PREFIX.PARALLEL,
  REFERENCE.PREFIX.VARIABLE,
] as const

/**
 * Loop reference fields
 */
export const LOOP_REFERENCE = {
  ITERATION: 'iteration',
  INDEX: 'index',
  ITEM: 'item',
  INDEX_PATH: 'loop.index',
} as const

/**
 * Parallel reference fields
 */
export const PARALLEL_REFERENCE = {
  INDEX: 'index',
  CURRENT_ITEM: 'currentItem',
  ITEMS: 'items',
} as const

export const DEFAULTS = {
  BLOCK_TYPE: 'unknown',
  BLOCK_TITLE: 'Untitled Block',
  WORKFLOW_NAME: 'Workflow',
  MAX_LOOP_ITERATIONS: 1000,
  MAX_WORKFLOW_DEPTH: 10,
  EXECUTION_TIME: 0,
  TOKENS: {
    PROMPT: 0,
    COMPLETION: 0,
    TOTAL: 0,
  },
  COST: {
    INPUT: 0,
    OUTPUT: 0,
    TOTAL: 0,
  },
} as const

export const HTTP = {
  STATUS: {
    OK: 200,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    SERVER_ERROR: 500,
  },
  CONTENT_TYPE: {
    JSON: 'application/json',
    EVENT_STREAM: 'text/event-stream',
  },
} as const

export const AGENT = {
  DEFAULT_MODEL: 'gpt-4o',
  DEFAULT_FUNCTION_TIMEOUT: 5000,
  REQUEST_TIMEOUT: 120000,
  CUSTOM_TOOL_PREFIX: 'custom_',
} as const

export const ROUTER = {
  DEFAULT_MODEL: 'gpt-4o',
  DEFAULT_TEMPERATURE: 0,
  INFERENCE_TEMPERATURE: 0.1,
} as const

export const EVALUATOR = {
  DEFAULT_MODEL: 'gpt-4o',
  DEFAULT_TEMPERATURE: 0.1,
  RESPONSE_SCHEMA_NAME: 'evaluation_response',
  JSON_INDENT: 2,
} as const

export const CONDITION = {
  ELSE_LABEL: 'else',
  ELSE_TITLE: 'else',
} as const

export const PARSING = {
  JSON_RADIX: 10,
  PREVIEW_LENGTH: 200,
  PREVIEW_SUFFIX: '...',
} as const

/**
 * Condition configuration
 */
export interface ConditionConfig {
  id: string
  label?: string
  condition: string
}

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

export function isAgentBlockType(blockType: string | undefined): boolean {
  return blockType === BlockType.AGENT
}

export function getDefaultTokens() {
  return {
    prompt: DEFAULTS.TOKENS.PROMPT,
    completion: DEFAULTS.TOKENS.COMPLETION,
    total: DEFAULTS.TOKENS.TOTAL,
  }
}

export function getDefaultCost() {
  return {
    input: DEFAULTS.COST.INPUT,
    output: DEFAULTS.COST.OUTPUT,
    total: DEFAULTS.COST.TOTAL,
  }
}

export function buildReference(path: string): string {
  return `${REFERENCE.START}${path}${REFERENCE.END}`
}

export function buildLoopReference(property: string): string {
  return buildReference(`${REFERENCE.PREFIX.LOOP}${REFERENCE.PATH_DELIMITER}${property}`)
}

export function buildParallelReference(property: string): string {
  return buildReference(`${REFERENCE.PREFIX.PARALLEL}${REFERENCE.PATH_DELIMITER}${property}`)
}

export function buildVariableReference(variableName: string): string {
  return buildReference(`${REFERENCE.PREFIX.VARIABLE}${REFERENCE.PATH_DELIMITER}${variableName}`)
}

export function buildBlockReference(blockId: string, path?: string): string {
  return buildReference(path ? `${blockId}${REFERENCE.PATH_DELIMITER}${path}` : blockId)
}

export function buildLoopIndexCondition(maxIterations: number): string {
  return `${buildLoopReference(LOOP_REFERENCE.INDEX)} < ${maxIterations}`
}

export function buildEnvVarReference(varName: string): string {
  return `${REFERENCE.ENV_VAR_START}${varName}${REFERENCE.ENV_VAR_END}`
}

export function isReference(value: string): boolean {
  return value.startsWith(REFERENCE.START) && value.endsWith(REFERENCE.END)
}

export function isEnvVarReference(value: string): boolean {
  return value.startsWith(REFERENCE.ENV_VAR_START) && value.endsWith(REFERENCE.ENV_VAR_END)
}

export function extractEnvVarName(reference: string): string {
  return reference.substring(
    REFERENCE.ENV_VAR_START.length,
    reference.length - REFERENCE.ENV_VAR_END.length
  )
}

export function extractReferenceContent(reference: string): string {
  return reference.substring(REFERENCE.START.length, reference.length - REFERENCE.END.length)
}

export function parseReferencePath(reference: string): string[] {
  const content = extractReferenceContent(reference)
  return content.split(REFERENCE.PATH_DELIMITER)
}
