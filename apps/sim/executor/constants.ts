import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { LoopType, ParallelType } from '@/lib/workflows/types'

/**
 * Runtime-injected keys for trigger blocks that should be hidden from logs/display.
 * These are added during execution but aren't part of the block's static output schema.
 */
export const TRIGGER_INTERNAL_KEYS = ['webhook', 'workflowId'] as const
export type TriggerInternalKey = (typeof TRIGGER_INTERNAL_KEYS)[number]

export function isTriggerInternalKey(key: string): key is TriggerInternalKey {
  return TRIGGER_INTERNAL_KEYS.includes(key as TriggerInternalKey)
}

export enum BlockType {
  PARALLEL = 'parallel',
  LOOP = 'loop',
  ROUTER = 'router',
  ROUTER_V2 = 'router_v2',
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

export type SentinelType = 'start' | 'end'

export const EDGE = {
  CONDITION_PREFIX: 'condition-',
  CONDITION_TRUE: 'condition-true',
  CONDITION_FALSE: 'condition-false',
  ROUTER_PREFIX: 'router-',
  LOOP_CONTINUE: 'loop_continue',
  LOOP_CONTINUE_ALT: 'loop-continue-source',
  LOOP_EXIT: 'loop_exit',
  PARALLEL_EXIT: 'parallel_exit',
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

  SENTINEL: {
    PREFIX: 'parallel-',
    START_SUFFIX: '-sentinel-start',
    END_SUFFIX: '-sentinel-end',
    START_TYPE: 'start' as SentinelType,
    END_TYPE: 'end' as SentinelType,
    START_NAME_PREFIX: 'Parallel Start',
    END_NAME_PREFIX: 'Parallel End',
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

export const RESERVED_BLOCK_NAMES = [
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
  MAX_FOREACH_ITEMS: 1000,
  MAX_PARALLEL_BRANCHES: 20,
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
  DEFAULT_MODEL: 'claude-sonnet-4-5',
  get DEFAULT_FUNCTION_TIMEOUT() {
    return getMaxExecutionTimeout()
  },
  get REQUEST_TIMEOUT() {
    return getMaxExecutionTimeout()
  },
  CUSTOM_TOOL_PREFIX: 'custom_',
} as const

export const MCP = {
  TOOL_PREFIX: 'mcp-',
} as const

export const CREDENTIAL_SET = {
  PREFIX: 'credentialSet:',
} as const

export const CREDENTIAL = {
  FOREIGN_LABEL: 'Saved by collaborator',
} as const

export function isCredentialSetValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(CREDENTIAL_SET.PREFIX)
}

export function extractCredentialSetId(value: string): string {
  return value.slice(CREDENTIAL_SET.PREFIX.length)
}

export const MEMORY = {
  DEFAULT_SLIDING_WINDOW_SIZE: 10,
  DEFAULT_SLIDING_WINDOW_TOKENS: 4000,
  CONTEXT_WINDOW_UTILIZATION: 0.9,
  MAX_CONVERSATION_ID_LENGTH: 255,
  MAX_MESSAGE_CONTENT_BYTES: 100 * 1024,
} as const

export const ROUTER = {
  DEFAULT_MODEL: 'claude-sonnet-4-5',
  DEFAULT_TEMPERATURE: 0,
  INFERENCE_TEMPERATURE: 0.1,
} as const

export const EVALUATOR = {
  DEFAULT_MODEL: 'claude-sonnet-4-5',
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
  return blockType !== undefined && (TRIGGER_BLOCK_TYPES as readonly string[]).includes(blockType)
}

/**
 * Determines if a block behaves as a trigger based on its metadata and config.
 * This is used for execution flow decisions where trigger-like behavior matters.
 *
 * A block is considered trigger-like if:
 * - Its category is 'triggers'
 * - It has triggerMode enabled
 * - It's a starter block (legacy entry point)
 */
export function isTriggerBehavior(block: {
  metadata?: { category?: string; id?: string }
  config?: { params?: { triggerMode?: boolean } }
}): boolean {
  return (
    block.metadata?.category === 'triggers' ||
    block.config?.params?.triggerMode === true ||
    block.metadata?.id === BlockType.STARTER
  )
}

export function isMetadataOnlyBlockType(blockType: string | undefined): boolean {
  return (
    blockType !== undefined && (METADATA_ONLY_BLOCK_TYPES as readonly string[]).includes(blockType)
  )
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
  return blockType === BlockType.ROUTER || blockType === BlockType.ROUTER_V2
}

export function isRouterV2BlockType(blockType: string | undefined): boolean {
  return blockType === BlockType.ROUTER_V2
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
    input: DEFAULTS.TOKENS.PROMPT,
    output: DEFAULTS.TOKENS.COMPLETION,
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

export const PATTERNS = {
  UUID: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  UUID_V4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  UUID_PREFIX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  ENV_VAR_NAME: /^[A-Za-z_][A-Za-z0-9_]*$/,
} as const

export function isUuid(value: string): boolean {
  return PATTERNS.UUID.test(value)
}

export function isUuidV4(value: string): boolean {
  return PATTERNS.UUID_V4.test(value)
}

export function startsWithUuid(value: string): boolean {
  return PATTERNS.UUID_PREFIX.test(value)
}

export function isValidEnvVarName(name: string): boolean {
  return PATTERNS.ENV_VAR_NAME.test(name)
}

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
}

export function isCustomTool(toolId: string): boolean {
  return toolId.startsWith(AGENT.CUSTOM_TOOL_PREFIX)
}

export function isMcpTool(toolId: string): boolean {
  return toolId.startsWith(MCP.TOOL_PREFIX)
}

export function stripCustomToolPrefix(name: string): string {
  return name.startsWith(AGENT.CUSTOM_TOOL_PREFIX)
    ? name.slice(AGENT.CUSTOM_TOOL_PREFIX.length)
    : name
}

export function stripMcpToolPrefix(name: string): string {
  return name.startsWith(MCP.TOOL_PREFIX) ? name.slice(MCP.TOOL_PREFIX.length) : name
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Normalizes a name for comparison by converting to lowercase and removing spaces.
 * Used for both block names and variable names to ensure consistent matching.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}
