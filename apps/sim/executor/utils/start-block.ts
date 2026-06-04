import {
  inferContextFromKey,
  isInternalFileUrl,
  parseInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import {
  classifyStartBlockType,
  resolveStartCandidates,
  StartBlockPath,
} from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import {
  EXECUTION_CONTROL_OUTPUT_FIELD_NAMES,
  type NormalizedBlockOutput,
  type UserFile,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { safeAssign } from '@/tools/safe-assign'

type ExecutionKind = 'chat' | 'manual' | 'api' | 'external'

const EXECUTION_CONTROL_OUTPUT_FIELD_NAME_SET = new Set<string>(
  EXECUTION_CONTROL_OUTPUT_FIELD_NAMES
)

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

function normalizeLegacyStarterMode(modeValue: unknown): 'manual' | 'api' | 'chat' | null {
  if (modeValue === 'chat') return 'chat'
  if (modeValue === 'api' || modeValue === 'run') return 'api'
  if (modeValue === undefined || modeValue === 'manual') return 'manual'
  return null
}

function getSerializedLegacyStarterMode(block: SerializedBlock): 'manual' | 'api' | 'chat' | null {
  const fromMetadata = readMetadataSubBlockValue(block, 'startWorkflow')
  if (fromMetadata !== undefined) {
    return normalizeLegacyStarterMode(fromMetadata)
  }

  return normalizeLegacyStarterMode(block.config?.params?.startWorkflow)
}

function readInputFormatFieldName(field: InputFormatField): string | undefined {
  return typeof field.name === 'string' ? field.name.trim() : undefined
}

function collectExecutionControlFieldNames(fieldNames: Iterable<string | undefined>): string[] {
  const reservedFieldNames = new Set<string>()

  for (const fieldName of fieldNames) {
    if (fieldName && EXECUTION_CONTROL_OUTPUT_FIELD_NAME_SET.has(fieldName)) {
      reservedFieldNames.add(fieldName)
    }
  }

  return Array.from(reservedFieldNames)
}

function throwReservedStartOutputFieldsError(
  block: SerializedBlock,
  reservedFieldNames: string[],
  source: 'input format' | 'runtime input'
): never {
  const blockName = block.metadata?.name ?? block.id

  throw new Error(
    `Start block "${blockName}" cannot use reserved ${source} field name(s): ${reservedFieldNames.join(', ')}. These names control workflow execution and cannot be used as Start outputs. Rename these fields before running the workflow. Reserved names are: ${EXECUTION_CONTROL_OUTPUT_FIELD_NAMES.join(', ')}.`
  )
}

function assertNoReservedInputFormatFields(
  inputFormat: InputFormatField[],
  block: SerializedBlock
): void {
  const reservedFieldNames = collectExecutionControlFieldNames(
    inputFormat.map(readInputFormatFieldName)
  )

  if (reservedFieldNames.length === 0) {
    return
  }

  throwReservedStartOutputFieldsError(block, reservedFieldNames, 'input format')
}

function assertNoReservedStartOutputFields(
  output: NormalizedBlockOutput,
  block: SerializedBlock
): void {
  const reservedFieldNames = collectExecutionControlFieldNames(Object.keys(output))

  if (reservedFieldNames.length === 0) {
    return
  }

  throwReservedStartOutputFieldsError(block, reservedFieldNames, 'runtime input')
}

function pathConsumesInputFormat(
  path: StartBlockPath,
  legacyStarterMode: 'manual' | 'api' | 'chat' | null
): boolean {
  switch (path) {
    case StartBlockPath.SPLIT_CHAT:
      return false
    case StartBlockPath.LEGACY_STARTER:
      return legacyStarterMode !== 'chat'
    default:
      return true
  }
}

export function coerceValue(type: string | null | undefined, value: unknown): unknown {
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
  workflowInput: unknown
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
    const fieldName = readInputFormatFieldName(field)
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

    // Use the default value from inputFormat if the field value wasn't provided at runtime
    if (fieldValue === undefined || fieldValue === null) {
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

function normalizeStartFile(file: unknown): UserFile | null {
  if (!isPlainObject(file)) {
    return null
  }

  const id = typeof file.id === 'string' ? file.id : ''
  const name = typeof file.name === 'string' ? file.name : ''
  const url =
    typeof file.url === 'string' ? file.url : typeof file.path === 'string' ? file.path : ''
  const size = typeof file.size === 'number' ? file.size : Number.NaN
  const type = typeof file.type === 'string' ? file.type : ''
  const explicitKey = typeof file.key === 'string' ? file.key : ''

  let key = explicitKey
  let context = typeof file.context === 'string' ? file.context : undefined

  if (!key && url && isInternalFileUrl(url)) {
    try {
      const parsed = parseInternalFileUrl(url)
      key = parsed.key
      context = context || parsed.context
    } catch {
      return null
    }
  }

  if (!context && key) {
    try {
      context = inferContextFromKey(key)
    } catch {
      // Older file outputs may have opaque keys; keep the file shape intact.
    }
  }

  if (!id || !name || !url || !Number.isFinite(size) || !type || !key) {
    return null
  }

  return {
    id,
    name,
    url,
    size,
    type,
    key,
    ...(context && { context }),
    ...(typeof file.base64 === 'string' && { base64: file.base64 }),
  }
}

function getFilesFromWorkflowInput(workflowInput: unknown): UserFile[] | undefined {
  if (!isPlainObject(workflowInput)) {
    return undefined
  }
  const files = workflowInput.files
  if (!Array.isArray(files)) {
    return undefined
  }

  const normalizedFiles = files.map(normalizeStartFile)
  if (normalizedFiles.every((file): file is UserFile => Boolean(file))) {
    return normalizedFiles
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
  } else if (isPlainObject(workflowInput) && Object.hasOwn(workflowInput, 'files')) {
    output.files = undefined
  }
  return output
}

function ensureString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function buildUnifiedStartOutput(
  workflowInput: unknown,
  structuredInput: Record<string, unknown>,
  hasStructured: boolean
): NormalizedBlockOutput {
  const output: NormalizedBlockOutput = {}
  const structuredKeys = hasStructured ? new Set(Object.keys(structuredInput)) : null

  if (hasStructured) {
    for (const [key, value] of Object.entries(structuredInput)) {
      output[key] = value
    }
  }

  if (isPlainObject(workflowInput)) {
    for (const [key, value] of Object.entries(workflowInput)) {
      if (key === 'onUploadError') continue
      // Skip keys already set by schema-coerced structuredInput to
      // prevent raw workflowInput strings from overwriting typed values.
      if (structuredKeys?.has(key)) continue
      // Runtime values override defaults (except undefined/null which mean "not provided")
      if (value !== undefined && value !== null) {
        output[key] = value
      } else if (!Object.hasOwn(output, key)) {
        output[key] = value
      }
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
    safeAssign(output, finalObject)
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
  workflowInput: unknown,
  structuredInput: Record<string, unknown>,
  hasStructured: boolean
): NormalizedBlockOutput {
  const output: NormalizedBlockOutput = {}
  const structuredKeys = hasStructured ? new Set(Object.keys(structuredInput)) : null

  if (hasStructured) {
    for (const [key, value] of Object.entries(structuredInput)) {
      output[key] = value
    }
  }

  if (isPlainObject(workflowInput)) {
    for (const [key, value] of Object.entries(workflowInput)) {
      if (structuredKeys?.has(key)) continue
      if (value !== undefined && value !== null) {
        output[key] = value
      } else if (!Object.hasOwn(output, key)) {
        output[key] = value
      }
    }
  }

  return mergeFilesIntoOutput(output, workflowInput)
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
}

export function buildStartBlockOutput(options: StartBlockOutputOptions): NormalizedBlockOutput {
  const { resolution, workflowInput } = options
  const inputFormat = extractInputFormat(resolution.block)
  const legacyStarterMode =
    resolution.path === StartBlockPath.LEGACY_STARTER
      ? getSerializedLegacyStarterMode(resolution.block)
      : null

  if (pathConsumesInputFormat(resolution.path, legacyStarterMode)) {
    assertNoReservedInputFormatFields(inputFormat, resolution.block)
  }

  const { finalInput, structuredInput, hasStructured } = deriveInputFromFormat(
    inputFormat,
    workflowInput
  )

  let output: NormalizedBlockOutput

  switch (resolution.path) {
    case StartBlockPath.UNIFIED:
      output = buildUnifiedStartOutput(workflowInput, structuredInput, hasStructured)
      break

    case StartBlockPath.SPLIT_API:
    case StartBlockPath.SPLIT_INPUT:
      output = buildApiOrInputOutput(finalInput, workflowInput)
      break

    case StartBlockPath.SPLIT_CHAT:
      output = buildChatOutput(workflowInput)
      break

    case StartBlockPath.SPLIT_MANUAL:
      output = buildManualTriggerOutput(finalInput, workflowInput)
      break

    case StartBlockPath.EXTERNAL_TRIGGER:
      output = buildIntegrationTriggerOutput(workflowInput, structuredInput, hasStructured)
      break

    case StartBlockPath.LEGACY_STARTER:
      output = buildLegacyStarterOutput(finalInput, workflowInput, legacyStarterMode)
      break

    default:
      output = buildManualTriggerOutput(finalInput, workflowInput)
  }

  assertNoReservedStartOutputFields(output, resolution.block)
  return output
}
