export enum BlockType {
  PARALLEL = 'parallel',
  LOOP = 'loop',
  ROUTER = 'router',
  CONDITION = 'condition',

  START_TRIGGER = 'start_trigger',
  STARTER = 'starter',
  TRIGGER = 'trigger',

  FUNCTION = 'function',
  AGENT = 'agent',
  API = 'api',
  EVALUATOR = 'evaluator',
  VARIABLES = 'variables',

  RESPONSE = 'response',
  HUMAN_IN_THE_LOOP = 'human_in_the_loop',
  WORKFLOW = 'workflow',
  WORKFLOW_INPUT = 'workflow_input',

  WAIT = 'wait',

  NOTE = 'note',

  SENTINEL_START = 'sentinel_start',
  SENTINEL_END = 'sentinel_end',
}

export const TRIGGER_BLOCK_TYPES = [
  BlockType.START_TRIGGER,
  BlockType.STARTER,
  BlockType.TRIGGER,
] as const

export const METADATA_ONLY_BLOCK_TYPES = [
  BlockType.LOOP,
  BlockType.PARALLEL,
  BlockType.NOTE,
] as const

export type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'

export type SentinelType = 'start' | 'end'

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

export const LOOP = {
  TYPE: {
    FOR: 'for' as LoopType,
    FOR_EACH: 'forEach' as LoopType,
    WHILE: 'while' as LoopType,
    DO_WHILE: 'doWhile',
  },

  SENTINEL: {
    PREFIX: 'loop-',
    START_SUFFIX: '-sentinel-start',
    END_SUFFIX: '-sentinel-end',
    START_TYPE: 'start' as SentinelType,
    END_TYPE: 'end' as SentinelType,
    START_NAME_PREFIX: 'Loop Start',
    END_NAME_PREFIX: 'Loop End',
  },
} as const

export const PARALLEL = {
  TYPE: {
    COLLECTION: 'collection' as ParallelType,
    COUNT: 'count' as ParallelType,
  },

  BRANCH: {
    PREFIX: '₍',
    SUFFIX: '₎',
  },

  DEFAULT_COUNT: 1,
} as const

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

export const LOOP_REFERENCE = {
  ITERATION: 'iteration',
  INDEX: 'index',
  ITEM: 'item',
  INDEX_PATH: 'loop.index',
} as const

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

export const PAUSE_RESUME = {
  OPERATION: {
    HUMAN: 'human',
    API: 'api',
  },
  PATH: {
    API_RESUME: '/api/resume',
    UI_RESUME: '/resume',
  },
} as const

export function buildResumeApiUrl(
  baseUrl: string | undefined,
  workflowId: string,
  executionId: string,
  contextId: string
): string {
  const prefix = baseUrl ?? ''
  return `${prefix}${PAUSE_RESUME.PATH.API_RESUME}/${workflowId}/${executionId}/${contextId}`
}

export function buildResumeUiUrl(
  baseUrl: string | undefined,
  workflowId: string,
  executionId: string
): string {
  const prefix = baseUrl ?? ''
  return `${prefix}${PAUSE_RESUME.PATH.UI_RESUME}/${workflowId}/${executionId}`
}

export const PARSING = {
  JSON_RADIX: 10,
  PREVIEW_LENGTH: 200,
  PREVIEW_SUFFIX: '...',
} as const

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files' | 'plain'

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

export function isAnnotationOnlyBlock(blockType: string | undefined): boolean {
  return blockType === BlockType.NOTE
}

export function supportsHandles(blockType: string | undefined): boolean {
  return !isAnnotationOnlyBlock(blockType)
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
