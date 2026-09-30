import { isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName } from '@sim/terminal-protocol'
import { isRecordLike } from '@sim/utils/object'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { GenerateApiKey, TOOL_CATALOG } from '@/lib/mothership/generated/tool-catalog-v1'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'
import {
  type OmittedStreamValue,
  STREAM_TRUNCATION_KEY,
  type StreamTruncatedField,
  type StreamTruncationMarker,
} from './omission'
import type { StreamEvent } from './types'

/**
 * An event whose payload serializes larger than this is compacted before it is
 * persisted and delivered. Well under the replay buffer's 1 MiB single-write
 * ceiling, so a compacted event is persistable.
 */
export const STREAM_EVENT_COMPACTION_THRESHOLD_BYTES = 256 * 1024

/**
 * Compaction stops once the payload fits this, leaving room in the per-stream
 * budget for a turn of many large tool results.
 */
export const STREAM_EVENT_COMPACTION_TARGET_BYTES = 128 * 1024

/** UTF-16 units kept at the head of a long string leaf. */
export const STREAM_STRING_PREVIEW_UNITS = 8 * 1024

/**
 * Second pass for payloads made large by many medium strings (retrieval
 * results): each is cut to this many units, keeping its sibling metadata.
 */
export const STREAM_SHORT_STRING_PREVIEW_UNITS = 500

/**
 * UTF-16 units of `args_delta` forwarded per tool call. The deltas only feed
 * a progressive title and a live preview of the arguments; the call frame and
 * the result supersede them, so the rest is not forwarded.
 */
export const TOOL_ARGS_DELTA_FORWARD_LIMIT_UNITS = 64 * 1024

/**
 * UTF-16 units per piece of a split assistant text. JSON escapes a unit to at
 * most six bytes, so a piece always serializes under the threshold.
 */
const SPLIT_TEXT_MAX_UNITS = Math.floor(STREAM_EVENT_COMPACTION_THRESHOLD_BYTES / 8)

/** Payload fields that restore, dedupe, and the UI key on; never compacted. */
const IDENTITY_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'activityDescription',
  'activityReceipt',
  'agent',
  'channel',
  'error',
  'event',
  'execName',
  'executor',
  'kind',
  'mode',
  'op',
  'partial',
  'phase',
  'replay',
  'resource',
  'status',
  'success',
  'targetWorkspaceId',
  'textLength',
  'textOffset',
  'toolCallId',
  'toolName',
  'ui',
  'workspaceId',
])

/**
 * Keys the UI reads from arguments and outputs (activity labels, targets,
 * cancellation). Kept whole at any depth.
 */
const PROTECTED_NESTED_KEYS: ReadonlySet<string> = new Set([
  'activity',
  'cancelledByUser',
  'description',
  'elementId',
  'fileName',
  'operation',
  'path',
  'pattern',
  'reason',
  'terminalId',
  'timeoutMs',
  'title',
  'toolId',
  'url',
  'workflowId',
])

type JsonRecord = Record<string, unknown>
type JsonContainer = JsonRecord | unknown[]

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value) ?? '')
}

/** Cuts at most `maxUnits` UTF-16 units without splitting a surrogate pair. */
function headUnits(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text
  const code = text.charCodeAt(maxUnits - 1)
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? maxUnits - 1 : maxUnits)
}

function splitText(text: string): string[] {
  const pieces: string[] = []
  let rest = text
  while (rest.length > 0) {
    const piece = headUnits(rest, SPLIT_TEXT_MAX_UNITS)
    pieces.push(piece)
    rest = rest.slice(piece.length)
  }
  return pieces
}

function pointer(base: string, key: string | number): string {
  return `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function entriesOf(container: JsonContainer): Array<[string | number, unknown]> {
  return Array.isArray(container)
    ? container.map((value, index) => [index, value])
    : Object.entries(container)
}

function setEntry(container: JsonContainer, key: string | number, value: unknown): void {
  if (Array.isArray(container)) container[Number(key)] = value
  else container[String(key)] = value
}

function isProtectedKey(key: string | number): boolean {
  return typeof key === 'string' && PROTECTED_NESTED_KEYS.has(key)
}

function containsProtectedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProtectedKey)
  if (!isRecordLike(value)) return false
  return Object.entries(value).some(
    ([key, field]) => PROTECTED_NESTED_KEYS.has(key) || containsProtectedKey(field)
  )
}

interface CompactionState {
  payload: JsonRecord
  roots: ReadonlySet<string>
  fields: Map<string, StreamTruncatedField>
}

/** Shortens every string leaf longer than `maxUnits` to its head, in place. */
function shortenStrings(
  state: CompactionState,
  container: JsonContainer,
  base: string,
  maxUnits: number
): void {
  for (const [key, value] of entriesOf(container)) {
    if (base === '' ? !state.roots.has(String(key)) : isProtectedKey(key)) continue
    const path = pointer(base, key)
    if (typeof value === 'string') {
      if (value.length <= maxUnits) continue
      const head = headUnits(value, maxUnits)
      const bytes = state.fields.get(path)?.bytes ?? utf8Bytes(value)
      state.fields.set(path, { path, bytes, previewBytes: utf8Bytes(head) })
      setEntry(container, key, head)
    } else if (Array.isArray(value) || isRecordLike(value)) {
      shortenStrings(state, value, path, maxUnits)
    }
  }
}

interface Candidate {
  container: JsonContainer
  key: string | number
  path: string
  bytes: number
}

function collectCandidates(
  state: CompactionState,
  container: JsonContainer,
  base: string,
  out: Candidate[]
): void {
  for (const [key, value] of entriesOf(container)) {
    if (base === '' ? !state.roots.has(String(key)) : isProtectedKey(key)) continue
    const path = pointer(base, key)
    if (Array.isArray(value) || isRecordLike(value)) {
      if (!containsProtectedKey(value)) {
        out.push({ container, key, path, bytes: jsonBytes(value) })
      }
      collectCandidates(state, value, path, out)
    } else if (typeof value === 'string') {
      out.push({ container, key, path, bytes: jsonBytes(value) })
    }
  }
}

/** Last resort: replaces the largest unprotected subtrees with stubs until the payload fits. */
function omitLargestSubtrees(state: CompactionState): void {
  const candidates: Candidate[] = []
  collectCandidates(state, state.payload, '', candidates)
  candidates.sort((a, b) => b.bytes - a.bytes)
  const omitted: string[] = []
  for (const candidate of candidates) {
    if (jsonBytes(state.payload) <= STREAM_EVENT_COMPACTION_TARGET_BYTES) return
    if (omitted.some((path) => candidate.path.startsWith(`${path}/`))) continue
    const stub: OmittedStreamValue = {
      omitted: true,
      bytes: state.fields.get(candidate.path)?.bytes ?? candidate.bytes,
    }
    setEntry(candidate.container, candidate.key, stub)
    for (const path of state.fields.keys()) {
      if (path.startsWith(`${candidate.path}/`)) state.fields.delete(path)
    }
    state.fields.set(candidate.path, { path: candidate.path, bytes: stub.bytes })
    omitted.push(candidate.path)
  }
}

/**
 * The browser may start these tools from the call frame's arguments, so the
 * arguments are never compacted; a frame too large with them whole is refused.
 */
function isClientExecutableCall(payload: JsonRecord): boolean {
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  const args = isRecordLike(payload.arguments) ? payload.arguments : undefined
  const catalogEntry = Object.hasOwn(TOOL_CATALOG, toolName) ? TOOL_CATALOG[toolName] : undefined
  return (
    payload.executor === MothershipStreamV1ToolExecutor.client ||
    (isRecordLike(payload.ui) && payload.ui.clientExecutable === true) ||
    catalogEntry?.route === 'client' ||
    catalogEntry?.clientExecutable === true ||
    isNativeFileTool(toolName) ||
    isUserLocalVfsToolCall(toolName, args) ||
    isCurrentBrowserToolName(toolName) ||
    isTerminalToolName(toolName)
  )
}

function isNeverCompacted(payload: JsonRecord): boolean {
  return (
    'previewPhase' in payload ||
    (payload.phase === MothershipStreamV1ToolPhase.result && payload.toolName === GenerateApiKey.id)
  )
}

function withPayload(event: StreamEvent, payload: JsonRecord): StreamEvent {
  return { ...event, payload } as StreamEvent
}

/**
 * Bounds one outgoing stream event so the replay buffer can persist it. Applied
 * only by the stream writer, to the copy it delivers and persists; the caller
 * keeps the full event for dispatch, the async tool row, and approval.
 *
 * Returns the event unchanged when its payload is within
 * {@link STREAM_EVENT_COMPACTION_THRESHOLD_BYTES}. Otherwise:
 * - assistant text splits into contiguous events whose concatenation is exact;
 * - long string leaves are cut to their head in place, so `arguments` and
 *   `output` keep their shape; a second pass cuts medium strings shorter;
 * - only if the payload is still too large are the largest unprotected subtrees
 *   replaced by an {@link OmittedStreamValue}.
 * Every changed field is listed in a payload-level {@link StreamTruncationMarker}.
 *
 * File previews, `generate_api_key` results, identity fields, and the arguments
 * of client-executable calls are never compacted; such an event that stays too
 * large is refused by the buffer and ends the turn with an error.
 */
export function compactStreamEventForReplay(event: StreamEvent): StreamEvent[] {
  const original = event.payload
  if (!isRecordLike(original)) return [event]
  const originalBytes = jsonBytes(original)
  if (originalBytes <= STREAM_EVENT_COMPACTION_THRESHOLD_BYTES || isNeverCompacted(original)) {
    return [event]
  }

  if (event.type === MothershipStreamV1EventType.text) {
    const { text, textOffset } = event.payload
    let offset = textOffset
    return splitText(text).map((piece) => {
      const split = withPayload(event, {
        ...original,
        text: piece,
        ...(offset !== undefined ? { textOffset: offset } : {}),
      })
      if (offset !== undefined) offset += piece.length
      return split
    })
  }

  const payload: JsonRecord = structuredClone(original)
  const protectsArguments =
    payload.phase === MothershipStreamV1ToolPhase.call && isClientExecutableCall(payload)
  const roots = new Set(
    Object.keys(payload).filter(
      (key) => !IDENTITY_PAYLOAD_KEYS.has(key) && !(protectsArguments && key === 'arguments')
    )
  )
  const state: CompactionState = { payload, roots, fields: new Map() }

  shortenStrings(state, payload, '', STREAM_STRING_PREVIEW_UNITS)
  if (jsonBytes(payload) > STREAM_EVENT_COMPACTION_TARGET_BYTES) {
    shortenStrings(state, payload, '', STREAM_SHORT_STRING_PREVIEW_UNITS)
  }
  if (jsonBytes(payload) > STREAM_EVENT_COMPACTION_TARGET_BYTES) {
    omitLargestSubtrees(state)
  }
  if (state.fields.size === 0) return [event]

  const marker: StreamTruncationMarker = {
    bytes: originalBytes,
    fields: [...state.fields.values()],
  }
  return [withPayload(event, { ...payload, [STREAM_TRUNCATION_KEY]: marker })]
}
