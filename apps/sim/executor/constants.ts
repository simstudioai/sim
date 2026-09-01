import {
  normalizeWorkflowBlockName,
  RESERVED_WORKFLOW_BLOCK_NAMES,
} from '@sim/workflow-types/workflow'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { LoopType, ParallelType } from '@/lib/workflows/types'
import { isCustomBlockType } from '@/blocks/custom/build-config'

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
  MOTHERSHIP = 'mothership',
  PI = 'pi',
  API = 'api',
  EVALUATOR = 'evaluator',
  VARIABLES = 'variables',

  RESPONSE = 'response',
  HUMAN_IN_THE_LOOP = 'human_in_the_loop',
  HUMAN_IN_THE_LOOP_V2 = 'human_in_the_loop_v2',
  WORKFLOW = 'workflow',
  WORKFLOW_INPUT = 'workflow_input',

  CREDENTIAL = 'credential',
  CREDENTIAL_GROUP = 'credential_group',

  WAIT = 'wait',

  NOTE = 'note',

  SENTINEL_START = 'sentinel_start',
  SENTINEL_END = 'sentinel_end',
}

/**
 * Every Human block version.
 *
 * v2 exists because its notification tools run through the same param transform an
 * agent block applies — canonical basic/advanced resolution and the block's own
 * `tools.config.params` function — which changes what a configured tool receives. A
 * single predicate keeps the two versions from drifting apart at the ten sites that
 * ask "is this the Human block?".
 */
export const HUMAN_IN_THE_LOOP_BLOCK_TYPES: readonly string[] = [
  BlockType.HUMAN_IN_THE_LOOP,
  BlockType.HUMAN_IN_THE_LOOP_V2,
]

/** Whether a block type is any version of the Human block. */
export function isHumanInTheLoopBlock(blockType: string | undefined | null): boolean {
  return typeof blockType === 'string' && HUMAN_IN_THE_LOOP_BLOCK_TYPES.includes(blockType)
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
  PARALLEL_CONTINUE: 'parallel_continue',
  PARALLEL_EXIT: 'parallel_exit',
  ERROR: 'error',
  SOURCE: 'source',
  DEFAULT: 'default',
} as const

export const SUBFLOW_CONTROL_EDGE_HANDLES = new Set<string>([
  EDGE.LOOP_CONTINUE,
  EDGE.LOOP_CONTINUE_ALT,
  EDGE.LOOP_EXIT,
  EDGE.PARALLEL_CONTINUE,
  EDGE.PARALLEL_EXIT,
])

export const CONTROL_BACK_EDGE_HANDLES = new Set<string>([
  EDGE.LOOP_CONTINUE,
  EDGE.LOOP_CONTINUE_ALT,
  EDGE.PARALLEL_CONTINUE,
])

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

/**
 * Delegates to the shared implementation in `@sim/workflow-types` so the
 * client store and the realtime persistence layer agree on the same reserved
 * names. Values intentionally mirror REFERENCE.PREFIX.{LOOP,PARALLEL,VARIABLE} above.
 */
export const RESERVED_BLOCK_NAMES = RESERVED_WORKFLOW_BLOCK_NAMES

export const LOOP_REFERENCE = {
  ITERATION: 'iteration',
  INDEX: 'index',
  ITEM: 'item',
  INDEX_PATH: 'loop.index',
} as const

export const DEFAULTS = {
  BLOCK_TYPE: 'unknown',
  BLOCK_TITLE: 'Untitled Block',
  WORKFLOW_NAME: 'Workflow',
  DEFAULT_LOOP_ITERATIONS: 1000,
  MAX_PARALLEL_BRANCHES: 20,
  MAX_NESTING_DEPTH: 10,
  /** Maximum child workflow depth for propagating SSE callbacks (block:started, block:completed). */
  MAX_SSE_CHILD_DEPTH: 3,
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
  DEFAULT_MODEL: 'claude-sonnet-5',
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

export const MEMORY = {
  DEFAULT_SLIDING_WINDOW_SIZE: 10,
  DEFAULT_SLIDING_WINDOW_TOKENS: 4000,
  CONTEXT_WINDOW_UTILIZATION: 0.9,
  MAX_CONVERSATION_ID_LENGTH: 255,
  MAX_MESSAGE_CONTENT_BYTES: 100 * 1024,
} as const

export const ROUTER = {
  DEFAULT_MODEL: 'claude-sonnet-5',
  DEFAULT_TEMPERATURE: 0,
  INFERENCE_TEMPERATURE: 0.1,
} as const

export const EVALUATOR = {
  DEFAULT_MODEL: 'claude-sonnet-5',
  DEFAULT_TEMPERATURE: 0.1,
  RESPONSE_SCHEMA_NAME: 'evaluation_response',
  JSON_INDENT: 2,
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

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files' | 'plain'

interface ConditionConfig {
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

/**
 * Internal marker carrying a custom block's child execution id from the workflow
 * handler out to the block executor, which lifts it onto the block log and strips
 * it before the output reaches workflow state. Underscore-prefixed so
 * `filterOutputForLog` drops it from every display and log projection.
 */
export const CHILD_EXECUTION_ID_OUTPUT_KEY = '_childExecutionId'

/**
 * Internal marker saying a custom block ran a child whose trace it deliberately
 * did not publish. Carried instead of {@link CHILD_EXECUTION_ID_OUTPUT_KEY}, never
 * beside it: withholding the handle is what makes tracing-off fail closed, and a
 * marker that travelled with the handle would be one dropped field away from
 * joining a run the caller opted out of. Underscore-prefixed for the same reason.
 *
 * Recorded because a boundary span with no children renders exactly like a leaf
 * block, so an untraced invocation would otherwise read as one that did nothing.
 *
 * Neither key may become a globally hidden output key: on the Agent-tool path the
 * block log's nested `toolCalls[].result` is the only carrier from the tool
 * response to the tool span, so hiding them there would silently stop custom
 * blocks invoked as tools from joining their child runs at all.
 */
export const CHILD_TRACE_DISABLED_OUTPUT_KEY = '_childTraceDisabled'

/**
 * Whether a block runs another workflow underneath it, and therefore owns a
 * nested subtree in the trace/terminal — a workflow block, or a custom block
 * whose publisher opted its runs into consumer traces.
 *
 * Deliberately wider than {@link isWorkflowBlockType}, which stays narrow because
 * it also gates whether the child workflow's NAME may be attached to an error —
 * something a custom block's consumer must never receive.
 */
export function isSubExecutionBlockType(blockType: string | undefined): boolean {
  return isWorkflowBlockType(blockType) || isCustomBlockType(blockType)
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

export function buildReference(path: string): string {
  return `${REFERENCE.START}${path}${REFERENCE.END}`
}

export function buildLoopReference(property: string): string {
  return buildReference(`${REFERENCE.PREFIX.LOOP}${REFERENCE.PATH_DELIMITER}${property}`)
}

export function buildLoopIndexCondition(maxIterations: number): string {
  return `${buildLoopReference(LOOP_REFERENCE.INDEX)} < ${maxIterations}`
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

export function sanitizeFileName(fileName: string | null | undefined): string {
  if (!fileName || typeof fileName !== 'string') {
    return 'untitled'
  }
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Normalizes a name for comparison by converting to lowercase and removing
 * spaces and dots. Used for both block names and variable names to ensure
 * consistent matching.
 *
 * Delegates to the shared implementation in `@sim/workflow-types` so the
 * client store and the realtime persistence layer normalize block names
 * identically when checking for reserved/duplicate names.
 */
export function normalizeName(name: string): string {
  return normalizeWorkflowBlockName(name)
}
