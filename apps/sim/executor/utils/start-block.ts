import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { HttpError } from '@/lib/core/utils/http-error'
import {
  extractWorkspaceIdFromStorageKey,
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
  START_BLOCK_METADATA_FIELD,
  type StartBlockRunMetadata,
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
    .filter((field): field is InputFormatField => isRecordLike(field))
    .map((field) => field)
}

/**
 * Reads the Start block's "Add run metadata" toggle from the serialized block.
 */
export function isRunMetadataEnabled(block: SerializedBlock): boolean {
  const value = readMetadataSubBlockValue(block, 'runMetadata') ?? block.config?.params?.runMetadata
  return value === true || value === 'true'
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

/**
 * A Start input the declared field type cannot represent.
 *
 * Raised before any block runs, so the run fails at start naming the field and
 * the value it received instead of continuing on a value of the wrong type —
 * a `number` field handed `"not-a-number"` used to keep the string and branch
 * downstream conditions on it. 400 because the payload, not the workflow, is
 * what is malformed; the message names only caller-authored values.
 */
export class StartInputValidationError extends HttpError {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'StartInputValidationError'
  }
}

/** Maximum characters of a rejected value quoted back in the error message. */
const REJECTED_VALUE_PREVIEW_LENGTH = 80

function describeRejectedValue(value: unknown): string {
  const encoded = typeof value === 'string' ? JSON.stringify(value) : String(value)
  return truncate(encoded, REJECTED_VALUE_PREVIEW_LENGTH)
}

/**
 * Coerces one declared Start field and rejects a value its type cannot hold.
 *
 * {@link coerceValue} is deliberately lenient (it also seeds editor defaults),
 * so on its own a `number` field given `"abc"` kept the string and a `boolean`
 * field given `"yes"` kept that. Here the coerced value is held to the declared
 * type. An empty string is left to the lenient path because the editor stores
 * `''` as a field's unset default, so rejecting it would fail every run that
 * omits an optional field.
 */
function coerceDeclaredValue(
  field: InputFormatField,
  fieldName: string,
  value: unknown,
  block: SerializedBlock | undefined
): unknown {
  const coerced = coerceValue(field.type, value)
  if (block === undefined || coerced === undefined || coerced === null) {
    return coerced
  }
  if (typeof value === 'string' && value.trim() === '') {
    return coerced
  }

  const holdsDeclaredType =
    field.type === 'number'
      ? typeof coerced === 'number' && Number.isFinite(coerced)
      : field.type === 'boolean'
        ? typeof coerced === 'boolean'
        : true
  if (holdsDeclaredType) {
    return coerced
  }

  const blockName = block.metadata?.name ?? block.id
  const expected = field.type === 'number' ? 'a number' : 'true or false'
  throw new StartInputValidationError(
    `Start block "${blockName}" field "${fieldName}" expects ${expected} but received ${describeRejectedValue(value)}. Send ${expected} or omit the field.`
  )
}

interface DerivedInputResult {
  structuredInput: Record<string, unknown>
  finalInput: unknown
  hasStructured: boolean
}

/**
 * `validatingBlock` is the Start block whose declared field types the values
 * are held to; `undefined` keeps the lenient coercion for paths that never read
 * the structured input (the chat path ignores its `inputFormat` entirely).
 */
function deriveInputFromFormat(
  inputFormat: InputFormatField[],
  workflowInput: unknown,
  validatingBlock: SerializedBlock | undefined
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
    const workflowRecord = isRecordLike(workflowInput) ? workflowInput : undefined

    if (workflowRecord) {
      const inputContainer = workflowRecord.input
      if (isRecordLike(inputContainer) && Object.hasOwn(inputContainer, fieldName)) {
        fieldValue = inputContainer[fieldName]
      } else if (Object.hasOwn(workflowRecord, fieldName)) {
        fieldValue = workflowRecord[fieldName]
      }
    }

    // Use the default value from inputFormat if the field value wasn't provided at runtime
    if (fieldValue === undefined || fieldValue === null) {
      fieldValue = field.value
    }

    structuredInput[fieldName] = coerceDeclaredValue(field, fieldName, fieldValue, validatingBlock)
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
  if (isRecordLike(workflowInput) && Object.hasOwn(workflowInput, 'input')) {
    return workflowInput.input
  }
  return workflowInput
}

/**
 * The storage key for a Start file, when the caller can prove the execution's
 * workspace owns it.
 *
 * Checks the supplied key first and the key parsed out of an internal URL
 * second; both are caller-authored, so both are held to the same ownership test
 * and neither is preferred for being "more official".
 */
function resolveOwnedStartFileKey(suppliedKey: unknown, url: string, workspaceId: string): string {
  if (typeof suppliedKey === 'string' && suppliedKey) {
    if (extractWorkspaceIdFromStorageKey(suppliedKey) === workspaceId) {
      return suppliedKey
    }
    return ''
  }

  if (!url || !isInternalFileUrl(url)) {
    return ''
  }

  try {
    const parsed = parseInternalFileUrl(url)
    return extractWorkspaceIdFromStorageKey(parsed.key) === workspaceId ? parsed.key : ''
  } catch {
    return ''
  }
}

/**
 * Normalizes one caller-supplied file object into the executor's canonical
 * {@link UserFile}, or returns `null` when the shape is not usable.
 *
 * A storage key names a specific tenant's bytes, so the test is ownership, not
 * provenance: a key is accepted when its own layout names the workspace this
 * execution runs in — `workspace/{workspaceId}/…` or
 * `execution/{workspaceId}/…` — and rejected otherwise. That holds whether the
 * key arrives directly or is parsed out of the file's URL, so neither source has
 * to be trusted: {@link isInternalFileUrl} matches the path prefix on any host,
 * and a caller can author either field.
 *
 * Both sources have to be honoured. The server-side uploader for run inputs
 * hands back a *presigned cloud* URL whenever object storage is configured
 * (`generatePresignedDownloadUrl`), whose path is the bucket key rather than
 * `/api/files/serve/...` — so a URL-only rule silently drops every chat
 * attachment, API `files[]` payload and webhook file field on any deployment
 * that is not using local storage, while passing locally and in tests.
 *
 * Key layouts that name no workspace (`kb/`, `chat/`, `copilot/`, the
 * world-readable prefixes) prove no ownership and are rejected, as is every file
 * when the execution carries no workspace at all. `context` is derived from the
 * accepted key rather than read from the payload or the URL's `?context=`, so it
 * cannot label owned bytes with a bucket they do not live in.
 */
function normalizeStartFile(file: unknown, workspaceId: string | undefined): UserFile | null {
  if (!isRecordLike(file) || !workspaceId) {
    return null
  }

  const id = typeof file.id === 'string' ? file.id : ''
  const name = typeof file.name === 'string' ? file.name : ''
  const url =
    typeof file.url === 'string' ? file.url : typeof file.path === 'string' ? file.path : ''
  const size = typeof file.size === 'number' ? file.size : Number.NaN
  const type = typeof file.type === 'string' ? file.type : ''

  const key = resolveOwnedStartFileKey(file.key, url, workspaceId)
  let context: string | undefined
  if (key) {
    try {
      context = inferContextFromKey(key)
    } catch {
      return null
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

function getFilesFromWorkflowInput(
  workflowInput: unknown,
  workspaceId: string | undefined
): UserFile[] | undefined {
  if (!isRecordLike(workflowInput)) {
    return undefined
  }
  const files = workflowInput.files
  if (!Array.isArray(files)) {
    return undefined
  }

  const normalizedFiles = files.map((file) => normalizeStartFile(file, workspaceId))
  if (normalizedFiles.every((file): file is UserFile => Boolean(file))) {
    return normalizedFiles
  }
  return undefined
}

function mergeFilesIntoOutput(
  output: NormalizedBlockOutput,
  workflowInput: unknown,
  workspaceId: string | undefined
): NormalizedBlockOutput {
  const files = getFilesFromWorkflowInput(workflowInput, workspaceId)
  if (files) {
    output.files = files
  } else if (isRecordLike(workflowInput) && Object.hasOwn(workflowInput, 'files')) {
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

  if (isRecordLike(workflowInput)) {
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
      isRecordLike(workflowInput) && typeof workflowInput.input !== 'undefined'
        ? ensureString(workflowInput.input)
        : ''
    output.input = fallbackInput ? fallbackInput : undefined
  } else if (typeof output.input === 'string' && output.input.length === 0) {
    output.input = undefined
  }

  if (!Object.hasOwn(output, 'conversationId')) {
    const conversationId =
      isRecordLike(workflowInput) && workflowInput.conversationId
        ? ensureString(workflowInput.conversationId)
        : undefined
    if (conversationId) {
      output.conversationId = conversationId
    }
  } else if (typeof output.conversationId === 'string' && output.conversationId.length === 0) {
    output.conversationId = undefined
  }

  return output
}

function buildApiOrInputOutput(finalInput: unknown, workflowInput: unknown): NormalizedBlockOutput {
  const isObjectInput = isRecordLike(finalInput)

  const output: NormalizedBlockOutput = isObjectInput
    ? {
        ...(finalInput as Record<string, unknown>),
        input: { ...(finalInput as Record<string, unknown>) },
      }
    : { input: finalInput }

  return output
}

function buildChatOutput(workflowInput: unknown): NormalizedBlockOutput {
  const source = isRecordLike(workflowInput) ? workflowInput : undefined

  const output: NormalizedBlockOutput = {
    input: ensureString(source?.input),
  }

  const conversationId = ensureString(source?.conversationId)
  if (conversationId) {
    output.conversationId = conversationId
  }

  return output
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
  const finalObject = isRecordLike(finalInput) ? finalInput : undefined

  if (finalObject) {
    safeAssign(output, finalObject)
    output.input = { ...finalObject }
  } else {
    output.input = finalInput
  }

  const conversationId = isRecordLike(workflowInput) ? workflowInput.conversationId : undefined
  if (conversationId) {
    output.conversationId = ensureString(conversationId)
  }

  return output
}

function buildManualTriggerOutput(
  finalInput: unknown,
  workflowInput: unknown
): NormalizedBlockOutput {
  const finalObject = isRecordLike(finalInput) ? (finalInput as Record<string, unknown>) : undefined

  const output: NormalizedBlockOutput = finalObject ? { ...finalObject } : { input: finalInput }

  if (!Object.hasOwn(output, 'input')) {
    output.input = getRawInputCandidate(workflowInput)
  }

  return output
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

  if (isRecordLike(workflowInput)) {
    for (const [key, value] of Object.entries(workflowInput)) {
      if (structuredKeys?.has(key)) continue
      if (value !== undefined && value !== null) {
        output[key] = value
      } else if (!Object.hasOwn(output, key)) {
        output[key] = value
      }
    }
  }

  return output
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
  if (isRecordLike(subBlocks)) {
    return subBlocks
  }

  return undefined
}

export interface StartBlockOutputOptions {
  resolution: ExecutorStartResolution
  workflowInput: unknown
  /** Trusted, server-built run metadata. Only applied when the block's toggle is on. */
  runMetadata?: StartBlockRunMetadata
  /**
   * Workspace this execution runs in. Caller-supplied Start files are admitted
   * only when their storage key names this workspace; absent it, none are.
   */
  workspaceId?: string
}

function assertNoMetadataInputFormatField(
  inputFormat: InputFormatField[],
  block: SerializedBlock
): void {
  const hasMetadataField = inputFormat.some(
    (field) => readInputFormatFieldName(field) === START_BLOCK_METADATA_FIELD
  )

  if (!hasMetadataField) {
    return
  }

  const blockName = block.metadata?.name ?? block.id
  throw new Error(
    `Start block "${blockName}" has "Add run metadata" enabled, which reserves the "${START_BLOCK_METADATA_FIELD}" output. Rename the "${START_BLOCK_METADATA_FIELD}" input format field or disable the toggle.`
  )
}

export function buildStartBlockOutput(options: StartBlockOutputOptions): NormalizedBlockOutput {
  const { resolution, workflowInput } = options
  const inputFormat = extractInputFormat(resolution.block)
  const runMetadataEnabled = isRunMetadataEnabled(resolution.block)
  const legacyStarterMode =
    resolution.path === StartBlockPath.LEGACY_STARTER
      ? getSerializedLegacyStarterMode(resolution.block)
      : null

  const consumesInputFormat = pathConsumesInputFormat(resolution.path, legacyStarterMode)
  if (consumesInputFormat) {
    assertNoReservedInputFormatFields(inputFormat, resolution.block)
    if (runMetadataEnabled) {
      assertNoMetadataInputFormatField(inputFormat, resolution.block)
    }
  }

  const { finalInput, structuredInput, hasStructured } = deriveInputFromFormat(
    inputFormat,
    workflowInput,
    consumesInputFormat ? resolution.block : undefined
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

  output = mergeFilesIntoOutput(output, workflowInput, options.workspaceId)

  if (runMetadataEnabled) {
    // The metadata key is server-owned when the toggle is on: any caller-supplied
    // value is dropped, and absent trusted metadata leaves the key absent (fail closed).
    delete output[START_BLOCK_METADATA_FIELD]
    if (options.runMetadata) {
      output[START_BLOCK_METADATA_FIELD] = { ...options.runMetadata }
    }
  }

  assertNoReservedStartOutputFields(output, resolution.block)
  return output
}
