import { isRecordLike } from '@sim/utils/object'
import { parseInternalOutputSelector } from '@/lib/workflows/streaming/output-selector'

export const SLACK_STREAM_RESPONSE_EVENTS = [
  'message',
  'app_mention',
  'assistant_thread_started',
] as const

export interface SlackStreamOutputConfig {
  blockId: string
  path: string
}

export interface SlackStreamResponseConfig {
  enabled: true
  outputConfigs: SlackStreamOutputConfig[]
  includeThinking: boolean
  includeToolCalls: boolean
  taskTitle: string
  taskDisplayMode: 'timeline' | 'plan'
}

const SLACK_TASK_TITLE_LIMIT = 256

function parseSlackOutputSelector(selector: string): SlackStreamOutputConfig {
  const parsed = parseInternalOutputSelector(selector)
  if (!parsed.path) {
    throw new Error(`Invalid Slack stream output selector: ${selector}`)
  }
  return parsed
}

/** Converts trigger authoring fields into the durable Slack streaming contract. */
export function normalizeSlackStreamResponseConfig(
  providerConfig: Record<string, unknown>
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

  return {
    enabled: true,
    outputConfigs: selectors.map(parseSlackOutputSelector),
    includeThinking: providerConfig.streamIncludeThinking === true,
    includeToolCalls: providerConfig.streamIncludeToolCalls !== false,
    taskTitle,
    taskDisplayMode,
  }
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
    if (!isRecordLike(output) || typeof output.blockId !== 'string' || !output.blockId) {
      throw new Error('Persisted Slack stream output is missing a block ID')
    }
    if (typeof output.path !== 'string' || !output.path) {
      throw new Error('Persisted Slack stream output is missing an output path')
    }
    return { blockId: output.blockId, path: output.path }
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
}
