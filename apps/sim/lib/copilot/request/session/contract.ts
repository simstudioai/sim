import type {
  MothershipStreamV1EventEnvelope,
  MothershipStreamV1StreamRef,
  MothershipStreamV1StreamScope,
  MothershipStreamV1Trace,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { FilePreviewTargetKind } from './file-preview-session-contract'

type JsonRecord = Record<string, unknown>

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

// ---------------------------------------------------------------------------
// Structural helpers (CSP-safe – no codegen / eval / new Function)
// ---------------------------------------------------------------------------

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
    value.streamId.length > 0 &&
    isOptionalString(value.chatId) &&
    isOptionalString(value.cursor)
  )
}

function isTrace(value: unknown): value is MothershipStreamV1Trace {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    isOptionalString(value.goTraceId) &&
    isOptionalString(value.spanId)
  )
}

function isStreamScope(value: unknown): value is MothershipStreamV1StreamScope {
  return (
    isRecord(value) &&
    value.lane === 'subagent' &&
    isOptionalString(value.agentId) &&
    isOptionalString(value.parentToolCallId)
  )
}

// ---------------------------------------------------------------------------
// Contract envelope validator (replaces Ajv runtime compilation)
//
// Validates the envelope shell (v, seq, ts, stream, trace?, scope?) and that
// `type` is one of the known event types with a non-null payload object.
// Per-payload-variant validation is intentionally lightweight: the server
// already performs strict schema validation; the client only needs enough
// structural checking to safely dispatch inside the switch statement.
// ---------------------------------------------------------------------------

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(MothershipStreamV1EventType))

function isValidEnvelopeShell(value: unknown): value is JsonRecord & {
  v: 1
  seq: number
  ts: string
  stream: MothershipStreamV1StreamRef
  type: string
  payload: JsonRecord
} {
  if (!isRecord(value)) return false
  if (value.v !== 1) return false
  if (typeof value.seq !== 'number' || !Number.isFinite(value.seq)) return false
  if (typeof value.ts !== 'string') return false
  if (!isStreamRef(value.stream)) return false
  if (value.trace !== undefined && !isTrace(value.trace)) return false
  if (value.scope !== undefined && !isStreamScope(value.scope)) return false
  if (typeof value.type !== 'string' || !KNOWN_EVENT_TYPES.has(value.type)) return false
  if (!isRecord(value.payload)) return false
  return true
}

function isValidSessionPayload(payload: JsonRecord): boolean {
  const kind = payload.kind
  if (typeof kind !== 'string') return false
  switch (kind) {
    case MothershipStreamV1SessionKind.start:
      return true
    case MothershipStreamV1SessionKind.chat:
      return typeof payload.chatId === 'string'
    case MothershipStreamV1SessionKind.title:
      return typeof payload.title === 'string'
    case MothershipStreamV1SessionKind.trace:
      return typeof payload.requestId === 'string'
    default:
      return false
  }
}

function isValidTextPayload(payload: JsonRecord): boolean {
  return (
    (payload.channel === MothershipStreamV1TextChannel.assistant ||
      payload.channel === MothershipStreamV1TextChannel.thinking) &&
    typeof payload.text === 'string'
  )
}

function isValidToolPayload(payload: JsonRecord): boolean {
  if (typeof payload.toolCallId !== 'string') return false
  if (typeof payload.toolName !== 'string') return false
  const phase = payload.phase
  return (
    phase === MothershipStreamV1ToolPhase.call ||
    phase === MothershipStreamV1ToolPhase.args_delta ||
    phase === MothershipStreamV1ToolPhase.result
  )
}

function isValidSpanPayload(payload: JsonRecord): boolean {
  const kind = payload.kind
  return (
    kind === MothershipStreamV1SpanPayloadKind.subagent ||
    kind === MothershipStreamV1SpanPayloadKind.structured_result ||
    kind === MothershipStreamV1SpanPayloadKind.subagent_result
  )
}

function isValidResourcePayload(payload: JsonRecord): boolean {
  return (
    (payload.op === MothershipStreamV1ResourceOp.upsert ||
      payload.op === MothershipStreamV1ResourceOp.remove) &&
    isRecord(payload.resource) &&
    typeof (payload.resource as JsonRecord).id === 'string' &&
    typeof (payload.resource as JsonRecord).type === 'string'
  )
}

function isValidRunPayload(payload: JsonRecord): boolean {
  const kind = payload.kind
  return (
    kind === MothershipStreamV1RunKind.checkpoint_pause ||
    kind === MothershipStreamV1RunKind.resumed ||
    kind === MothershipStreamV1RunKind.compaction_start ||
    kind === MothershipStreamV1RunKind.compaction_done
  )
}

function isValidErrorPayload(payload: JsonRecord): boolean {
  return typeof payload.message === 'string' || typeof payload.error === 'string'
}

function isValidCompletePayload(payload: JsonRecord): boolean {
  return typeof payload.status === 'string'
}

function isContractEnvelope(value: unknown): value is MothershipStreamV1EventEnvelope {
  if (!isValidEnvelopeShell(value)) return false
  const payload = value.payload as JsonRecord
  switch (value.type) {
    case MothershipStreamV1EventType.session:
      return isValidSessionPayload(payload)
    case MothershipStreamV1EventType.text:
      return isValidTextPayload(payload)
    case MothershipStreamV1EventType.tool:
      return isValidToolPayload(payload)
    case MothershipStreamV1EventType.span:
      return isValidSpanPayload(payload)
    case MothershipStreamV1EventType.resource:
      return isValidResourcePayload(payload)
    case MothershipStreamV1EventType.run:
      return isValidRunPayload(payload)
    case MothershipStreamV1EventType.error:
      return isValidErrorPayload(payload)
    case MothershipStreamV1EventType.complete:
      return isValidCompletePayload(payload)
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Synthetic file-preview envelope validators
// ---------------------------------------------------------------------------

function isSyntheticEnvelopeBase(value: unknown): value is Omit<
  SyntheticFilePreviewEventEnvelope,
  'payload'
> & {
  payload?: unknown
} {
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

// ---------------------------------------------------------------------------
// Stream event type guards
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public contract validators & parsers
// ---------------------------------------------------------------------------

export function isContractStreamEventEnvelope(
  value: unknown
): value is MothershipStreamV1EventEnvelope {
  return isContractEnvelope(value)
}

export function parsePersistedStreamEventEnvelope(value: unknown): ParseStreamEventEnvelopeResult {
  if (isContractEnvelope(value)) {
    return { ok: true, event: value }
  }

  if (isSyntheticFilePreviewEventEnvelope(value)) {
    return { ok: true, event: value }
  }

  const hints: string[] = []
  if (!isRecord(value)) {
    hints.push('value is not an object')
  } else {
    if (value.v !== 1) hints.push(`unexpected v=${JSON.stringify(value.v)}`)
    if (typeof value.type !== 'string') hints.push('missing type')
    else if (!KNOWN_EVENT_TYPES.has(value.type)) hints.push(`unknown type="${value.type}"`)
    if (!isRecord(value.payload)) hints.push('missing or invalid payload')
  }

  return {
    ok: false,
    reason: 'invalid_stream_event',
    message: 'A stream event failed validation.',
    ...(hints.length > 0 ? { errors: hints } : {}),
  }
}

export function parsePersistedStreamEventEnvelopeJson(raw: string): ParseStreamEventEnvelopeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Invalid JSON'
    return {
      ok: false,
      reason: 'invalid_json',
      message: 'Received invalid JSON while parsing a stream event.',
      ...(rawMessage ? { errors: [rawMessage] } : {}),
    }
  }

  return parsePersistedStreamEventEnvelope(parsed)
}
