import { isUserFile } from '@/lib/utils'
import {
  classifyStartBlockType,
  getLegacyStarterMode,
  resolveStartCandidates,
  StartBlockPath,
} from '@/lib/workflows/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import type { NormalizedBlockOutput, UserFile } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

type ExecutionKind = 'chat' | 'manual' | 'api'

export interface ExecutorStartResolution {
  blockId: string
  block: SerializedBlock
  path: StartBlockPath
}

export interface ResolveExecutorStartOptions {
  execution: ExecutionKind
  isChildWorkflow: boolean
}

type StartCandidateWrapper = {
  type: string
  subBlocks?: Record<string, unknown>
  original: SerializedBlock
}

export function resolveExecutorStartBlock(
  blocks: SerializedBlock[],
  options: ResolveExecutorStartOptions
): ExecutorStartResolution | null {
  if (blocks.length === 0) {
    return null
  }

  const blockMap = blocks.reduce<Record<string, StartCandidateWrapper>>((acc, block) => {
    const type = block.metadata?.id
    if (!type) {
      return acc
    }

    acc[block.id] = {
      type,
      subBlocks: extractSubBlocks(block),
      original: block,
    }

    return acc
  }, {})

  const candidates = resolveStartCandidates(blockMap, {
    execution: options.execution,
    isChildWorkflow: options.isChildWorkflow,
  })

  if (candidates.length === 0) {
    return null
  }

  if (options.isChildWorkflow && candidates.length > 1) {
    throw new Error('Child workflow has multiple trigger blocks. Keep only one Start block.')
  }

  const [primary] = candidates
  return {
    blockId: primary.blockId,
    block: primary.block.original,
    path: primary.path,
  }
}

export function buildResolutionFromBlock(block: SerializedBlock): ExecutorStartResolution | null {
  const type = block.metadata?.id
  if (!type) {
    return null
  }

  const category = block.metadata?.category
  const triggerModeEnabled = block.config?.params?.triggerMode === true

  const path = classifyStartBlockType(type, {
    category,
    triggerModeEnabled,
  })
  if (!path) {
    return null
  }

  return {
    blockId: block.id,
    block,
    path,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readMetadataSubBlockValue(block: SerializedBlock, key: string): unknown {
  const metadata = block.metadata
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }

  const maybeWithSubBlocks = metadata as typeof metadata & {
    subBlocks?: Record<string, unknown>
  }

  const raw = maybeWithSubBlocks.subBlocks?.[key]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }

  return (raw as { value?: unknown }).value
}

function extractInputFormat(block: SerializedBlock): InputFormatField[] {
  const fromMetadata = readMetadataSubBlockValue(block, 'inputFormat')
  const fromParams = block.config?.params?.inputFormat
  const source = fromMetadata ?? fromParams

  if (!Array.isArray(source)) {
    return []
  }

  return source
    .filter((field): field is InputFormatField => isPlainObject(field))
    .map((field) => field)
}

function coerceValue(type: string | null | undefined, value: unknown): unknown {
  if (value === undefined || value === null) {
    return value
  }

  switch (type) {
    case 'string':
      return typeof value === 'string' ? value : String(value)
    case 'number': {
      if (typeof value === 'number') return value
      const parsed = Number(value)
      return Number.isNaN(parsed) ? value : parsed
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === '1' || value === 1) return true
      if (value === 'false' || value === '0' || value === 0) return false
      return value
    }
    case 'object':
    case 'array': {
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          return parsed
        } catch {
          return value
        }
      }
      return value
    }
    default:
      return value
  }
}

interface DerivedInputResult {
  structuredInput: Record<string, unknown>
  finalInput: unknown
  hasStructured: boolean
}

function deriveInputFromFormat(
  inputFormat: InputFormatField[],
  workflowInput: unknown,
  isDeployedExecution: boolean
): DerivedInputResult {
  const structuredInput: Record<string, unknown> = {}

  if (inputFormat.length === 0) {
    return {
      structuredInput,
      finalInput: getRawInputCandidate(workflowInput),
      hasStructured: false,
    }
  }

  for (const field of inputFormat) {
    const fieldName = field.name?.trim()
    if (!fieldName) continue

    let fieldValue: unknown
    const workflowRecord = isPlainObject(workflowInput) ? workflowInput : undefined

    if (workflowRecord) {
      const inputContainer = workflowRecord.input
      if (isPlainObject(inputContainer) && Object.hasOwn(inputContainer, fieldName)) {
        fieldValue = inputContainer[fieldName]
      } else if (Object.hasOwn(workflowRecord, fieldName)) {
        fieldValue = workflowRecord[fieldName]
      }
    }

    if ((fieldValue === undefined || fieldValue === null) && !isDeployedExecution) {
      fieldValue = field.value
    }

    structuredInput[fieldName] = coerceValue(field.type, fieldValue)
  }

  const hasStructured = Object.keys(structuredInput).length > 0
  const finalInput = hasStructured ? structuredInput : getRawInputCandidate(workflowInput)

  return {
    structuredInput,
    finalInput,
    hasStructured,
  }
}

function getRawInputCandidate(workflowInput: unknown): unknown {
  if (isPlainObject(workflowInput) && Object.hasOwn(workflowInput, 'input')) {
    return workflowInput.input
  }
  return workflowInput
}

function getFilesFromWorkflowInput(workflowInput: unknown): UserFile[] | undefined {
  if (!isPlainObject(workflowInput)) {
    return undefined
  }
  const files = workflowInput.files
  if (Array.isArray(files) && files.every(isUserFile)) {
    return files
  }
  return undefined
}

function mergeFilesIntoOutput(
  output: NormalizedBlockOutput,
  workflowInput: unknown
): NormalizedBlockOutput {
  const files = getFilesFromWorkflowInput(workflowInput)
  if (files) {
    output.files = files
  }
  return output
}

function ensureString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function buildUnifiedStartOutput(workflowInput: unknown): NormalizedBlockOutput {
  const output: NormalizedBlockOutput = {}

  if (isPlainObject(workflowInput)) {
    for (const [key, value] of Object.entries(workflowInput)) {
      if (key === 'onUploadError') continue
      output[key] = value
    }
  }

  if (!Object.hasOwn(output, 'input')) {
    const fallbackInput =
      isPlainObject(workflowInput) && typeof workflowInput.input !== 'undefined'
        ? ensureString(workflowInput.input)
        : ''
    output.input = fallbackInput ? fallbackInput : undefined
  } else if (typeof output.input === 'string' && output.input.length === 0) {
    output.input = undefined
  }

  if (!Object.hasOwn(output, 'conversationId')) {
    const conversationId =
      isPlainObject(workflowInput) && workflowInput.conversationId
        ? ensureString(workflowInput.conversationId)
        : undefined
    if (conversationId) {
      output.conversationId = conversationId
    }
  } else if (typeof output.conversationId === 'string' && output.conversationId.length === 0) {
    output.conversationId = undefined
  }

  return mergeFilesIntoOutput(output, workflowInput)
}

function buildApiOrInputOutput(finalInput: unknown, workflowInput: unknown): NormalizedBlockOutput {
  const isObjectInput = isPlainObject(finalInput)

  const output: NormalizedBlockOutput = isObjectInput
    ? {
        ...(finalInput as Record<string, unknown>),
        input: { ...(finalInput as Record<string, unknown>) },
      }
    : { input: finalInput }

  return mergeFilesIntoOutput(output, workflowInput)
}

function buildChatOutput(workflowInput: unknown): NormalizedBlockOutput {
  const source = isPlainObject(workflowInput) ? workflowInput : undefined

  const output: NormalizedBlockOutput = {
    input: ensureString(source?.input),
  }

  const conversationId = ensureString(source?.conversationId)
  if (conversationId) {
    output.conversationId = conversationId
  }

  return mergeFilesIntoOutput(output, workflowInput)
}

function buildLegacyStarterOutput(
  finalInput: unknown,
  workflowInput: unknown,
  mode: 'manual' | 'api' | 'chat' | null
): NormalizedBlockOutput {
  if (mode === 'chat') {
    return buildChatOutput(workflowInput)
  }

  const output: NormalizedBlockOutput = {}
  const finalObject = isPlainObject(finalInput) ? finalInput : undefined

  if (finalObject) {
    Object.assign(output, finalObject)
    output.input = { ...finalObject }
  } else {
    output.input = finalInput
  }

  const conversationId = isPlainObject(workflowInput) ? workflowInput.conversationId : undefined
  if (conversationId) {
    output.conversationId = ensureString(conversationId)
  }

  return mergeFilesIntoOutput(output, workflowInput)
}

function buildManualTriggerOutput(
  finalInput: unknown,
  workflowInput: unknown
): NormalizedBlockOutput {
  const finalObject = isPlainObject(finalInput)
    ? (finalInput as Record<string, unknown>)
    : undefined

  const output: NormalizedBlockOutput = finalObject ? { ...finalObject } : { input: finalInput }

  if (!Object.hasOwn(output, 'input')) {
    output.input = getRawInputCandidate(workflowInput)
  }

  return mergeFilesIntoOutput(output, workflowInput)
}

function buildIntegrationTriggerOutput(
  finalInput: unknown,
  workflowInput: unknown
): NormalizedBlockOutput {
  const base: NormalizedBlockOutput = isPlainObject(workflowInput)
    ? ({ ...(workflowInput as Record<string, unknown>) } as NormalizedBlockOutput)
    : {}

  if (isPlainObject(finalInput)) {
    Object.assign(base, finalInput as Record<string, unknown>)
    base.input = { ...(finalInput as Record<string, unknown>) }
  } else {
    base.input = finalInput
  }

  return mergeFilesIntoOutput(base, workflowInput)
}

function extractSubBlocks(block: SerializedBlock): Record<string, unknown> | undefined {
  const metadata = block.metadata
  if (!metadata || typeof metadata !== 'object') {
    return undefined
  }

  const maybeWithSubBlocks = metadata as typeof metadata & {
    subBlocks?: Record<string, unknown>
  }

  const subBlocks = maybeWithSubBlocks.subBlocks
  if (subBlocks && typeof subBlocks === 'object' && !Array.isArray(subBlocks)) {
    return subBlocks
  }

  return undefined
}

export interface StartBlockOutputOptions {
  resolution: ExecutorStartResolution
  workflowInput: unknown
  isDeployedExecution: boolean
}

export function buildStartBlockOutput(options: StartBlockOutputOptions): NormalizedBlockOutput {
  const { resolution, workflowInput, isDeployedExecution } = options
  const inputFormat = extractInputFormat(resolution.block)
  const { finalInput } = deriveInputFromFormat(inputFormat, workflowInput, isDeployedExecution)

  switch (resolution.path) {
    case StartBlockPath.UNIFIED:
      return buildUnifiedStartOutput(workflowInput)

    case StartBlockPath.SPLIT_API:
    case StartBlockPath.SPLIT_INPUT:
      return buildApiOrInputOutput(finalInput, workflowInput)

    case StartBlockPath.SPLIT_CHAT:
      return buildChatOutput(workflowInput)

    case StartBlockPath.SPLIT_MANUAL:
      return buildManualTriggerOutput(finalInput, workflowInput)

    case StartBlockPath.EXTERNAL_TRIGGER:
      return buildIntegrationTriggerOutput(finalInput, workflowInput)

    case StartBlockPath.LEGACY_STARTER:
      return buildLegacyStarterOutput(
        finalInput,
        workflowInput,
        getLegacyStarterMode({ subBlocks: extractSubBlocks(resolution.block) })
      )
    default:
      return buildManualTriggerOutput(finalInput, workflowInput)
  }
}
