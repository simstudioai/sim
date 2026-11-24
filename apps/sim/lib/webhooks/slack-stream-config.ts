import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import {
  formatInternalOutputSelector,
  parsePublicOutputSelector,
  resolveOutputBlockRef,
} from '@/lib/workflows/streaming/output-selector'
import { normalizeName } from '@/executor/constants'
import { SLACK_STREAM_RESPONSE_EVENTS } from '@/triggers/slack/shared'

interface SlackStreamOutputConfig extends SlackStreamBlockRef {
  path: string
}

export interface SlackStreamResponseConfig {
  enabled: true
  outputConfigs: SlackStreamOutputConfig[]
  includeThinking: boolean
  includeToolCalls: boolean
  taskTitle: string
  taskDisplayMode: 'timeline' | 'plan'
  /** Agent blocks whose tool steps (and thinking, when enabled) are shown without their text. */
  timelineSources: SlackStreamBlockRef[]
  /** Display titles for tool steps, keyed by tool name (an MCP tool by its own name). */
  toolLabels: Record<string, string>
}

/** A block of the triggered workflow, or of a child workflow when `workflowId` is set. */
export interface SlackStreamBlockRef {
  workflowId?: string
  blockId: string
}

type SlackStreamAuthoringBlocks = Record<string, { id: string; name?: string; type?: string }>

const SLACK_TASK_TITLE_LIMIT = 256
/** A timeline source streams through its Agent's answer output, which is never posted. */
export const SLACK_TIMELINE_SOURCE_PATH = 'content'
const SLACK_TIMELINE_SOURCE_BLOCK_TYPE = 'agent'

function parseSlackOutputSelector(
  selector: string,
  currentBlocks: Record<string, { id: string; name?: string }>,
  currentBlockRefs: ReadonlySet<string>
): SlackStreamOutputConfig {
  const parsed = parsePublicOutputSelector(selector, { currentBlockRefs })
  if (!parsed.path) {
    throw new Error(`Invalid Slack stream output selector: ${selector}`)
  }
  const blockId = parsed.workflowId
    ? parsed.blockId
    : resolveOutputBlockRef(parsed.blockId, currentBlocks)
  return { ...parsed, blockId }
}

/** Accepts `<block>` or `<childWorkflowId>.<block>`, with or without the `.content` the picker adds. */
function parseSlackTimelineSource(
  selector: string,
  blocks: SlackStreamAuthoringBlocks,
  currentBlockRefs: ReadonlySet<string>
): SlackStreamBlockRef {
  const suffix = `.${SLACK_TIMELINE_SOURCE_PATH}`
  const parsed = parsePublicOutputSelector(
    selector.endsWith(suffix) ? selector : `${selector}${suffix}`,
    { currentBlockRefs }
  )
  if (parsed.path !== SLACK_TIMELINE_SOURCE_PATH) {
    throw new Error(`Slack timeline source must select an Agent block: ${selector}`)
  }
  if (parsed.workflowId) return { workflowId: parsed.workflowId, blockId: parsed.blockId }
  const blockId = resolveOutputBlockRef(parsed.blockId, blocks)
  if (blocks[blockId]?.type !== SLACK_TIMELINE_SOURCE_BLOCK_TYPE) {
    throw new Error(`Slack timeline source must be an Agent block: ${selector}`)
  }
  return { blockId }
}

function sameBlock(a: SlackStreamBlockRef, b: SlackStreamBlockRef): boolean {
  return a.blockId === b.blockId && a.workflowId === b.workflowId
}

/** Reads the editor's Tool/Label table, skipping incomplete rows. */
function parseSlackToolLabels(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {}
  if (!Array.isArray(value)) throw new Error('Slack tool step labels must be a table')
  const labels: Record<string, string> = {}
  for (const row of value) {
    const cells = isRecordLike(row) ? toRecordOrNull(row.cells) : null
    const tool = typeof cells?.Tool === 'string' ? cells.Tool.trim() : ''
    const label = typeof cells?.Label === 'string' ? cells.Label.trim() : ''
    if (!tool || !label) continue
    if (label.length > SLACK_TASK_TITLE_LIMIT) {
      throw new Error(
        `Slack tool step label for ${tool} must be ${SLACK_TASK_TITLE_LIMIT} characters or fewer`
      )
    }
    labels[tool] = label
  }
  return labels
}

/** Converts trigger authoring fields into the durable Slack streaming contract. */
export function normalizeSlackStreamResponseConfig(
  providerConfig: Record<string, unknown>,
  blocks: SlackStreamAuthoringBlocks
): SlackStreamResponseConfig | null {
  if (providerConfig.streamResponse !== true) return null

  if (
    typeof providerConfig.eventType !== 'string' ||
    !SLACK_STREAM_RESPONSE_EVENTS.includes(
      providerConfig.eventType as (typeof SLACK_STREAM_RESPONSE_EVENTS)[number]
    )
  ) {
    throw new Error('Slack streaming is only supported for reply-capable trigger events')
  }
  if (!Array.isArray(providerConfig.streamOutputs) || providerConfig.streamOutputs.length === 0) {
    throw new Error('Select at least one workflow output to stream to Slack')
  }
  const selectors = providerConfig.streamOutputs.map((value) => {
    if (typeof value !== 'string' || !value) {
      throw new Error('Slack stream output selectors must be non-empty strings')
    }
    return value
  })
  const taskDisplayMode = providerConfig.streamTaskDisplayMode ?? 'timeline'
  if (taskDisplayMode !== 'timeline' && taskDisplayMode !== 'plan') {
    throw new Error('Slack stream task display mode must be timeline or plan')
  }
  const rawTaskTitle = providerConfig.streamTaskTitle ?? ''
  if (typeof rawTaskTitle !== 'string') {
    throw new Error('Slack stream response status label must be a string')
  }
  const taskTitle = rawTaskTitle.trim() || 'Running'
  if (taskTitle.length > SLACK_TASK_TITLE_LIMIT) {
    throw new Error(
      `Slack stream response status label must be ${SLACK_TASK_TITLE_LIMIT} characters or fewer`
    )
  }
  const currentBlockRefs = new Set<string>()
  for (const block of Object.values(blocks)) {
    currentBlockRefs.add(block.id)
    if (block.name) currentBlockRefs.add(normalizeName(block.name))
  }

  const rawTimelineSources = providerConfig.streamTimelineSources ?? []
  if (!Array.isArray(rawTimelineSources)) {
    throw new Error('Slack timeline sources must be a list of Agent blocks')
  }
  const outputConfigs = selectors.map((selector) =>
    parseSlackOutputSelector(selector, blocks, currentBlockRefs)
  )
  const timelineSources = rawTimelineSources.map((value) => {
    if (typeof value !== 'string' || !value) {
      throw new Error('Slack timeline sources must be non-empty strings')
    }
    const source = parseSlackTimelineSource(value, blocks, currentBlockRefs)
    if (outputConfigs.some((output) => sameBlock(output, source))) {
      throw new Error(`A block cannot be both a streamed output and a timeline source: ${value}`)
    }
    return source
  })

  return {
    enabled: true,
    outputConfigs,
    includeThinking: providerConfig.streamIncludeThinking === true,
    includeToolCalls: providerConfig.streamIncludeToolCalls !== false,
    taskTitle,
    taskDisplayMode,
    timelineSources,
    toolLabels: parseSlackToolLabels(providerConfig.streamToolLabels),
  }
}

/** Validates a persisted block reference; `kind` names it in errors. */
function readBlockRef(value: unknown, kind: string): SlackStreamBlockRef {
  if (!isRecordLike(value) || typeof value.blockId !== 'string' || !value.blockId) {
    throw new Error(`Persisted Slack ${kind} is missing a block ID`)
  }
  if (value.workflowId === undefined) return { blockId: value.blockId }
  if (typeof value.workflowId !== 'string' || !value.workflowId) {
    throw new Error(`Persisted Slack ${kind} has an invalid workflow ID`)
  }
  return { workflowId: value.workflowId, blockId: value.blockId }
}

function readTimelineSources(value: unknown): SlackStreamBlockRef[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Persisted Slack timeline sources are invalid')
  return value.map((source) => readBlockRef(source, 'timeline source'))
}

function readToolLabels(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecordLike(value)) throw new Error('Persisted Slack tool step labels are invalid')
  return Object.fromEntries(
    Object.entries(value).map(([tool, label]) => {
      if (typeof label !== 'string') throw new Error('Persisted Slack tool step labels are invalid')
      return [tool, label]
    })
  )
}

/** Reads and validates the normalized config stored on a deployed webhook. */
export function readSlackStreamResponseConfig(
  providerConfig: Record<string, unknown>
): SlackStreamResponseConfig | null {
  const value = providerConfig.streamResponseConfig
  if (value === undefined) return null
  if (!isRecordLike(value) || value.enabled !== true) {
    throw new Error('Invalid persisted Slack stream response configuration')
  }
  if (!Array.isArray(value.outputConfigs) || value.outputConfigs.length === 0) {
    throw new Error('Persisted Slack stream configuration has no outputs')
  }
  const outputConfigs = value.outputConfigs.map((output) => {
    const ref = readBlockRef(output, 'stream output')
    const path = isRecordLike(output) ? output.path : undefined
    if (typeof path !== 'string' || !path) {
      throw new Error('Persisted Slack stream output is missing an output path')
    }
    formatInternalOutputSelector(ref.blockId, path, ref.workflowId)
    return { ...ref, path }
  })
  if (typeof value.includeThinking !== 'boolean' || typeof value.includeToolCalls !== 'boolean') {
    throw new Error('Persisted Slack stream visibility settings are invalid')
  }
  if (value.taskTitle !== undefined && typeof value.taskTitle !== 'string') {
    throw new Error('Persisted Slack stream response status label is invalid')
  }
  const taskTitle = value.taskTitle?.trim() || 'Running'
  if (taskTitle.length > SLACK_TASK_TITLE_LIMIT) {
    throw new Error('Persisted Slack stream response status label is too long')
  }
  if (value.taskDisplayMode !== 'timeline' && value.taskDisplayMode !== 'plan') {
    throw new Error('Persisted Slack stream task display mode is invalid')
  }
  return {
    enabled: true,
    outputConfigs,
    includeThinking: value.includeThinking,
    includeToolCalls: value.includeToolCalls,
    taskTitle,
    taskDisplayMode: value.taskDisplayMode,
    timelineSources: readTimelineSources(value.timelineSources),
    toolLabels: readToolLabels(value.toolLabels),
  }
}

export function isSlackStreamResponseRequested(providerConfig: Record<string, unknown>): boolean {
  return (
    providerConfig.streamResponse === true ||
    (isRecordLike(providerConfig.streamResponseConfig) &&
      providerConfig.streamResponseConfig.enabled === true)
  )
}

/** Replaces editor-only fields with the normalized durable contract. */
export function replaceSlackStreamAuthoringConfig(
  providerConfig: Record<string, unknown>,
  normalized: SlackStreamResponseConfig | null
): void {
  if (normalized) providerConfig.streamResponseConfig = normalized
  else providerConfig.streamResponseConfig = undefined
  providerConfig.streamResponse = undefined
  providerConfig.streamOutputs = undefined
  providerConfig.streamIncludeThinking = undefined
  providerConfig.streamIncludeToolCalls = undefined
  providerConfig.streamTaskTitle = undefined
  providerConfig.streamTaskDisplayMode = undefined
  providerConfig.streamTimelineSources = undefined
  providerConfig.streamToolLabels = undefined
}
