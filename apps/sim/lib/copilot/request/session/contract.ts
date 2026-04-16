import type { ErrorObject, ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import type {
  MothershipStreamV1EventEnvelope,
  MothershipStreamV1StreamRef,
  MothershipStreamV1StreamScope,
  MothershipStreamV1Trace,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { MOTHERSHIP_STREAM_V1_SCHEMA } from '@/lib/copilot/generated/mothership-stream-v1-schema'
import type { FilePreviewTargetKind } from './file-preview-session-contract'

type JsonRecord = Record<string, unknown>

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
})

const FILE_PREVIEW_PHASE = {
  start: 'file_preview_start',
  target: 'file_preview_target',
  editMeta: 'file_preview_edit_meta',
  content: 'file_preview_content',
  complete: 'file_preview_complete',
} as const

type EnvelopeToStreamEvent<T> = T extends {
  type: infer TType
  payload: infer TPayload
  scope?: infer TScope
}
  ? { type: TType; payload: TPayload; scope?: Exclude<TScope, undefined> }
  : never

export type SyntheticFilePreviewPhase = (typeof FILE_PREVIEW_PHASE)[keyof typeof FILE_PREVIEW_PHASE]

export interface SyntheticFilePreviewTarget {
  kind: FilePreviewTargetKind
  fileId?: string
  fileName?: string
}

export interface SyntheticFilePreviewStartPayload {
  previewPhase: typeof FILE_PREVIEW_PHASE.start
  toolCallId: string
  toolName: 'workspace_file'
}

export interface SyntheticFilePreviewTargetPayload {
  operation?: string
  previewPhase: typeof FILE_PREVIEW_PHASE.target
  target: SyntheticFilePreviewTarget
  title?: string
  toolCallId: string
  toolName: 'workspace_file'
}

export interface SyntheticFilePreviewEditMetaPayload {
  edit: JsonRecord
  previewPhase: typeof FILE_PREVIEW_PHASE.editMeta
  toolCallId: string
  toolName: 'workspace_file'
}

export interface SyntheticFilePreviewContentPayload {
  content: string
  contentMode: 'delta' | 'snapshot'
  edit?: JsonRecord
  fileId?: string
  fileName: string
  operation?: string
  previewPhase: typeof FILE_PREVIEW_PHASE.content
  previewVersion: number
  targetKind?: string
  toolCallId: string
  toolName: 'workspace_file'
}

export interface SyntheticFilePreviewCompletePayload {
  fileId?: string
  output?: unknown
  previewPhase: typeof FILE_PREVIEW_PHASE.complete
  previewVersion?: number
  toolCallId: string
  toolName: 'workspace_file'
}

export type SyntheticFilePreviewPayload =
  | SyntheticFilePreviewStartPayload
  | SyntheticFilePreviewTargetPayload
  | SyntheticFilePreviewEditMetaPayload
  | SyntheticFilePreviewContentPayload
  | SyntheticFilePreviewCompletePayload

export interface SyntheticFilePreviewEventEnvelope {
  payload: SyntheticFilePreviewPayload
  scope?: MothershipStreamV1StreamScope
  seq: number
  stream: MothershipStreamV1StreamRef
  trace?: MothershipStreamV1Trace
  ts: string
  type: 'tool'
  v: 1
}

export type PersistedStreamEventEnvelope =
  | MothershipStreamV1EventEnvelope
  | SyntheticFilePreviewEventEnvelope

export type ContractStreamEvent = EnvelopeToStreamEvent<MothershipStreamV1EventEnvelope>
export type SyntheticStreamEvent = EnvelopeToStreamEvent<SyntheticFilePreviewEventEnvelope>
export type SessionStreamEvent = ContractStreamEvent | SyntheticStreamEvent
export type StreamEvent = SessionStreamEvent
export type ToolCallStreamEvent = Extract<
  ContractStreamEvent,
  { type: 'tool'; payload: { phase: 'call' } }
>
export type ToolArgsDeltaStreamEvent = Extract<
  ContractStreamEvent,
  { type: 'tool'; payload: { phase: 'args_delta' } }
>
export type ToolResultStreamEvent = Extract<
  ContractStreamEvent,
  { type: 'tool'; payload: { phase: 'result' } }
>
export type SubagentSpanStreamEvent = Extract<
  ContractStreamEvent,
  { type: 'span'; payload: { kind: 'subagent' } }
>

export interface ParseStreamEventEnvelopeSuccess {
  ok: true
  event: PersistedStreamEventEnvelope
}

export interface ParseStreamEventEnvelopeFailure {
  errors?: string[]
  message: string
  ok: false
  reason: 'invalid_json' | 'invalid_stream_event'
}

export type ParseStreamEventEnvelopeResult =
  | ParseStreamEventEnvelopeSuccess
  | ParseStreamEventEnvelopeFailure

let validator: ValidateFunction<MothershipStreamV1EventEnvelope> | null = null

function getValidator(): ValidateFunction<MothershipStreamV1EventEnvelope> {
  if (validator) {
    return validator
  }

  validator = ajv.compile<MothershipStreamV1EventEnvelope>(MOTHERSHIP_STREAM_V1_SCHEMA as object)
  return validator
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] | undefined {
  if (!errors || errors.length === 0) {
    return undefined
  }

  return errors
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`.trim())
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isStreamRef(value: unknown): value is MothershipStreamV1StreamRef {
  return (
    isRecord(value) &&
    typeof value.streamId === 'string' &&
    isOptionalString(value.chatId) &&
    isOptionalString(value.cursor)
  )
}

function isTrace(value: unknown): value is MothershipStreamV1Trace {
  return isRecord(value) && typeof value.requestId === 'string' && isOptionalString(value.spanId)
}

function isStreamScope(value: unknown): value is MothershipStreamV1StreamScope {
  return (
    isRecord(value) &&
    value.lane === 'subagent' &&
    isOptionalString(value.agentId) &&
    isOptionalString(value.parentToolCallId)
  )
}

function isSyntheticEnvelopeBase(
  value: unknown
): value is Omit<SyntheticFilePreviewEventEnvelope, 'payload'> & { payload?: unknown } {
  return (
    isRecord(value) &&
    value.v === 1 &&
    value.type === 'tool' &&
    typeof value.seq === 'number' &&
    Number.isFinite(value.seq) &&
    typeof value.ts === 'string' &&
    isStreamRef(value.stream) &&
    (value.trace === undefined || isTrace(value.trace)) &&
    (value.scope === undefined || isStreamScope(value.scope))
  )
}

function isSyntheticFilePreviewTarget(value: unknown): value is SyntheticFilePreviewTarget {
  return (
    isRecord(value) &&
    (value.kind === 'new_file' || value.kind === 'file_id') &&
    isOptionalString(value.fileId) &&
    isOptionalString(value.fileName)
  )
}

function isSyntheticFilePreviewPayload(value: unknown): value is SyntheticFilePreviewPayload {
  if (!isRecord(value)) {
    return false
  }

  if (typeof value.toolCallId !== 'string' || value.toolName !== 'workspace_file') {
    return false
  }

  switch (value.previewPhase) {
    case FILE_PREVIEW_PHASE.start:
      return true
    case FILE_PREVIEW_PHASE.target:
      return (
        isSyntheticFilePreviewTarget(value.target) &&
        isOptionalString(value.operation) &&
        isOptionalString(value.title)
      )
    case FILE_PREVIEW_PHASE.editMeta:
      return isRecord(value.edit)
    case FILE_PREVIEW_PHASE.content:
      return (
        typeof value.content === 'string' &&
        (value.contentMode === 'delta' || value.contentMode === 'snapshot') &&
        typeof value.previewVersion === 'number' &&
        Number.isFinite(value.previewVersion) &&
        typeof value.fileName === 'string' &&
        isOptionalString(value.fileId) &&
        isOptionalString(value.targetKind) &&
        isOptionalString(value.operation) &&
        (value.edit === undefined || isRecord(value.edit))
      )
    case FILE_PREVIEW_PHASE.complete:
      return isOptionalString(value.fileId) && isOptionalFiniteNumber(value.previewVersion)
    default:
      return false
  }
}

export function isSyntheticFilePreviewEventEnvelope(
  value: unknown
): value is SyntheticFilePreviewEventEnvelope {
  return isSyntheticEnvelopeBase(value) && isSyntheticFilePreviewPayload(value.payload)
}

export function isToolCallStreamEvent(event: SessionStreamEvent): event is ToolCallStreamEvent {
  return event.type === 'tool' && isRecord(event.payload) && event.payload.phase === 'call'
}

export function isToolArgsDeltaStreamEvent(
  event: SessionStreamEvent
): event is ToolArgsDeltaStreamEvent {
  return event.type === 'tool' && isRecord(event.payload) && event.payload.phase === 'args_delta'
}

export function isToolResultStreamEvent(event: SessionStreamEvent): event is ToolResultStreamEvent {
  return event.type === 'tool' && isRecord(event.payload) && event.payload.phase === 'result'
}

export function isSubagentSpanStreamEvent(
  event: SessionStreamEvent
): event is SubagentSpanStreamEvent {
  return event.type === 'span' && isRecord(event.payload) && event.payload.kind === 'subagent'
}

export function isContractStreamEventEnvelope(
  value: unknown
): value is MothershipStreamV1EventEnvelope {
  return getValidator()(value)
}

export function parsePersistedStreamEventEnvelope(value: unknown): ParseStreamEventEnvelopeResult {
  const envelopeValidator = getValidator()
  if (envelopeValidator(value)) {
    return {
      ok: true,
      event: value,
    }
  }

  if (isSyntheticFilePreviewEventEnvelope(value)) {
    return {
      ok: true,
      event: value,
    }
  }

  return {
    ok: false,
    reason: 'invalid_stream_event',
    message: 'Stream event failed validation',
    errors: formatValidationErrors(envelopeValidator.errors),
  }
}

export function parsePersistedStreamEventEnvelopeJson(raw: string): ParseStreamEventEnvelopeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_json',
      message: error instanceof Error ? error.message : 'Invalid JSON',
    }
  }

  return parsePersistedStreamEventEnvelope(parsed)
}
