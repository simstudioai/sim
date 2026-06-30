import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { generateToolInputSchema, generateToolZodSchema } from '@/lib/mcp/workflow-tool-schema'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import {
  extractTriggerMockPayload,
  selectBestTrigger,
} from '@/lib/workflows/triggers/trigger-utils'
import {
  getLegacyStarterMode,
  resolveStartCandidates,
  type StartBlockCandidate,
  StartBlockPath,
} from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import { getBlock } from '@/blocks'
import { coerceValue } from '@/executor/utils/start-block'
import { getTrigger } from '@/triggers'

/**
 * How a trigger expects its run-time input, surfaced to the agent so it can tell
 * the difference between building flat form fields and an event payload.
 */
export type TriggerInputKind = 'fields' | 'event_payload' | 'chat' | 'none'

/** Minimal block shape needed to resolve and describe a trigger. */
interface TriggerBlockLike {
  type: string
  name?: string
  enabled?: boolean
  triggerMode?: boolean
  subBlocks?: Record<string, unknown>
}

export interface TriggerRunOption {
  /** The block ID to pass to run_workflow's triggerBlockId. */
  triggerBlockId: string
  blockName: string
  triggerType: string
  path: StartBlockPath
  isDefault: boolean
  inputKind: TriggerInputKind
  /** JSON-Schema-ish description of the input the agent should build. */
  inputSchema: Record<string, unknown>
  /** A ready-to-use example the agent may copy only if it can't build its own. */
  mockPayload: unknown
  /**
   * Raw input fields used for strict validation. Internal — callers serializing
   * to the agent should omit this (see toPublicRunOption).
   */
  inputFormat: InputFormatField[]
}

export interface TriggerInputValidationResult {
  ok: boolean
  error?: string
}

function readSubBlockValue(block: TriggerBlockLike, key: string): unknown {
  const raw = (block.subBlocks as Record<string, unknown> | undefined)?.[key]
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return (raw as { value?: unknown }).value
  }
  return undefined
}

function mapOutputType(type: string): string {
  switch (type) {
    case 'json':
      return 'object'
    case 'number':
    case 'boolean':
    case 'array':
    case 'object':
    case 'string':
      return type
    default:
      return 'string'
  }
}

function outputFieldToSchema(field: unknown): Record<string, unknown> {
  if (
    field &&
    typeof field === 'object' &&
    'type' in field &&
    typeof (field as { type: unknown }).type === 'string'
  ) {
    const typed = field as {
      type: string
      properties?: Record<string, unknown>
      items?: unknown
    }
    if ((typed.type === 'object' || typed.type === 'json') && typed.properties) {
      const properties: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(typed.properties)) {
        properties[key] = outputFieldToSchema(value)
      }
      return { type: 'object', properties }
    }
    if (typed.type === 'array' && typed.items) {
      return { type: 'array', items: outputFieldToSchema(typed.items) }
    }
    return { type: mapOutputType(typed.type) }
  }

  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const properties: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(field)) {
      properties[key] = outputFieldToSchema(value)
    }
    return { type: 'object', properties }
  }

  return { type: 'string' }
}

function triggerOutputsToJsonSchema(outputs: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(outputs)) {
    if (key === 'visualization') continue
    properties[key] = outputFieldToSchema(value)
  }
  return { type: 'object', properties }
}

function mockValueForType(type: string | undefined, name: string): unknown {
  switch (type) {
    case 'number':
      return 42
    case 'boolean':
      return true
    case 'array':
      return []
    case 'object':
      return {}
    case 'files':
    case 'file[]':
      return []
    default:
      return `mock_${name}`
  }
}

function buildFieldsSample(inputFormat: InputFormatField[]): Record<string, unknown> {
  const sample: Record<string, unknown> = {}
  for (const field of inputFormat) {
    if (!field.name) continue
    sample[field.name] =
      field.value !== undefined && field.value !== null
        ? coerceValue(field.type, field.value)
        : mockValueForType(field.type, field.name)
  }
  return sample
}

function resolveEventTriggerId(block: TriggerBlockLike): string {
  const selected = readSubBlockValue(block, 'selectedTriggerId')
  if (typeof selected === 'string' && selected) {
    return selected
  }
  const blockConfig = getBlock(block.type)
  if (blockConfig?.triggers?.available?.length === 1) {
    return blockConfig.triggers.available[0]
  }
  return block.type
}

function safeTriggerOutputs(triggerId: string): Record<string, unknown> | undefined {
  try {
    const trigger = getTrigger(triggerId)
    return trigger?.outputs as Record<string, unknown> | undefined
  } catch {
    return undefined
  }
}

function extractEventMockPayload(candidate: StartBlockCandidate<TriggerBlockLike>): unknown {
  const triggerId = resolveEventTriggerId(candidate.block)
  const sampleRaw =
    readSubBlockValue(candidate.block, `samplePayload_${triggerId}`) ??
    readSubBlockValue(candidate.block, 'samplePayload')

  if (typeof sampleRaw === 'string' && sampleRaw.trim()) {
    try {
      return JSON.parse(sampleRaw)
    } catch {
      // fall through to generated mock
    }
  } else if (sampleRaw && typeof sampleRaw === 'object') {
    return sampleRaw
  }

  return extractTriggerMockPayload(candidate)
}

function resolveInputKind(path: StartBlockPath, block: TriggerBlockLike): TriggerInputKind {
  if (path === StartBlockPath.SPLIT_CHAT) return 'chat'
  if (path === StartBlockPath.LEGACY_STARTER) {
    return getLegacyStarterMode(block) === 'chat' ? 'chat' : 'fields'
  }
  if (path === StartBlockPath.EXTERNAL_TRIGGER) {
    return block.type === 'schedule' ? 'none' : 'event_payload'
  }
  return 'fields'
}

function buildTriggerRunOption(
  candidate: StartBlockCandidate<TriggerBlockLike>,
  isDefault: boolean
): TriggerRunOption {
  const { blockId, block, path } = candidate
  const blockConfig = getBlock(block.type)
  const blockName = block.name || blockConfig?.name || block.type
  const inputKind = resolveInputKind(path, block)
  const inputFormat = normalizeInputFormatValue(readSubBlockValue(block, 'inputFormat'))

  let inputSchema: Record<string, unknown>
  let mockPayload: unknown

  switch (inputKind) {
    case 'fields': {
      inputSchema = generateToolInputSchema(inputFormat)
      mockPayload = buildFieldsSample(inputFormat)
      break
    }
    case 'event_payload': {
      const triggerId = resolveEventTriggerId(block)
      const outputs = safeTriggerOutputs(triggerId)
      inputSchema = outputs
        ? triggerOutputsToJsonSchema(outputs)
        : { type: 'object', properties: {} }
      mockPayload = extractEventMockPayload(candidate)
      break
    }
    case 'chat': {
      inputSchema = {
        type: 'object',
        required: ['input'],
        properties: {
          input: { type: 'string', description: 'User message' },
          conversationId: { type: 'string', description: 'Optional conversation ID' },
        },
      }
      mockPayload = { input: 'mock_message' }
      break
    }
    default: {
      inputSchema = { type: 'object', properties: {} }
      mockPayload = {}
      break
    }
  }

  return {
    triggerBlockId: blockId,
    blockName,
    triggerType: block.type,
    path,
    isDefault,
    inputKind,
    inputSchema,
    mockPayload,
    inputFormat,
  }
}

/**
 * Enumerates every runnable trigger in a workflow (across manual + chat entry
 * kinds), marking the one the executor would pick by default. Used by the
 * get_workflow_run_options tool (to describe) and run_workflow (to validate),
 * guaranteeing describe == enforce.
 */
export function resolveTriggerRunOptions(
  blocks: Record<string, TriggerBlockLike>,
  edges?: Array<{ source: string; target: string }>
): TriggerRunOption[] {
  const manual = resolveStartCandidates(blocks, { execution: 'manual' })
  const chat = resolveStartCandidates(blocks, { execution: 'chat' })

  const byId = new Map<string, StartBlockCandidate<TriggerBlockLike>>()
  for (const candidate of [...manual, ...chat]) {
    if (!byId.has(candidate.blockId)) {
      byId.set(candidate.blockId, candidate)
    }
  }

  const candidates = [...byId.values()]
  if (candidates.length === 0) {
    return []
  }

  // Single overall default (no edges => one best); ties broken by trigger priority.
  const defaultBlockId = selectBestTrigger(candidates)[0]?.blockId

  return candidates.map((candidate) =>
    buildTriggerRunOption(candidate, candidate.blockId === defaultBlockId)
  )
}

/** Strips internal fields so the option can be returned to the agent. */
export function toPublicRunOption(option: TriggerRunOption): {
  triggerBlockId: string
  blockName: string
  triggerType: string
  isDefault: boolean
  inputKind: TriggerInputKind
  inputSchema: Record<string, unknown>
  mockPayload: unknown
} {
  const { inputFormat: _inputFormat, path: _path, ...rest } = option
  return rest
}

/**
 * Strictly validates an agent-supplied workflow_input against a trigger. There
 * are no fallbacks: anything incorrect returns an error so the agent retries.
 */
export function validateTriggerInput(
  option: TriggerRunOption,
  input: unknown
): TriggerInputValidationResult {
  switch (option.inputKind) {
    case 'none':
      return { ok: true }

    case 'chat': {
      if (!isRecordLike(input) || typeof input.input !== 'string' || input.input.trim() === '') {
        return {
          ok: false,
          error: `Chat trigger "${option.blockName}" requires workflow_input shaped like { "input": "<message>" }.`,
        }
      }
      return { ok: true }
    }

    case 'event_payload': {
      if (!isRecordLike(input) || Object.keys(input).length === 0) {
        return {
          ok: false,
          error:
            `Trigger "${option.blockName}" (${option.triggerType}) requires a non-empty event payload. ` +
            `Build workflow_input matching this shape, or run with useMockPayload: true. ` +
            `Expected shape: ${JSON.stringify(option.inputSchema)}`,
        }
      }
      return { ok: true }
    }
    default: {
      const baseShape = generateToolZodSchema(option.inputFormat)
      if (!baseShape) {
        // Trigger declares no input fields — accept an object (including {}).
        if (input === undefined || input === null) return { ok: true }
        if (!isRecordLike(input)) {
          return {
            ok: false,
            error: `Trigger "${option.blockName}" expects a JSON object for workflow_input.`,
          }
        }
        return { ok: true }
      }

      // A field with an author-configured default is optional: the executor fills
      // the default when it's omitted (deriveInputFromFormat), so requiring it
      // would reject a run the workflow itself accepts.
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [name, baseType] of Object.entries(baseShape)) {
        const zodType = baseType as z.ZodTypeAny
        const field = option.inputFormat.find((f) => f.name === name)
        const hasDefault = field?.value !== undefined && field?.value !== null
        shape[name] = hasDefault ? zodType.optional() : zodType
      }

      // UNIFIED start blocks pass arbitrary keys through to their output, so
      // unknown keys are valid there; other trigger kinds only consume declared
      // fields, so unknown keys signal a mistake and are rejected.
      const objectSchema = z.object(shape)
      const schema =
        option.path === StartBlockPath.UNIFIED ? objectSchema.passthrough() : objectSchema.strict()
      const result = schema.safeParse(input ?? {})
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')
        return {
          ok: false,
          error:
            `workflow_input does not match trigger "${option.blockName}" (${issues}). ` +
            `Expected: ${JSON.stringify(option.inputSchema)}`,
        }
      }
      return { ok: true }
    }
  }
}
