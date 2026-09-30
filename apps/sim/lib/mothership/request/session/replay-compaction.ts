import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import { MothershipStreamV1ToolPhase } from '@/lib/mothership/generated/mothership-stream-v1'
import { isClientExecutedToolCall } from '@/lib/mothership/tools/client-executed-tools'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import type { StreamEvent } from './types'

/**
 * Payloads whose strings could serialize past this are compacted before they are
 * persisted and delivered; well under the replay buffer's 1 MiB write ceiling.
 */
export const STREAM_EVENT_COMPACTION_THRESHOLD_BYTES = 256 * 1024

/** UTF-16 units kept at the head of a long string. */
export const STREAM_STRING_PREVIEW_UNITS = 8 * 1024

/** Identity fields and the keys the UI reads from arguments and outputs; kept whole at any depth. */
const PRESERVED_KEYS: ReadonlySet<string> = new Set([
  'activity',
  'activityDescription',
  'agent',
  'cancelledByUser',
  'channel',
  'description',
  'elementId',
  'error',
  'event',
  'execName',
  'executor',
  'fileName',
  'kind',
  'mode',
  'op',
  'operation',
  'partial',
  'path',
  'pattern',
  'phase',
  'reason',
  'replay',
  'resource',
  'status',
  'success',
  'targetWorkspaceId',
  'terminalId',
  'timeoutMs',
  'title',
  'toolCallId',
  'toolId',
  'toolName',
  'ui',
  'url',
  'workflowId',
  'workspaceId',
])

/** Its live result is the only place the plaintext key reaches the browser. */
const GENERATE_API_KEY_TOOL = 'generate_api_key'

function stringUnits(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + stringUnits(item), 0)
  if (!isRecordLike(value)) return 0
  let sum = 0
  for (const key in value) sum += key.length + stringUnits(value[key])
  return sum
}

/** Cuts long strings to a head with a readable size note, copying only what changes. */
function truncateStrings(value: unknown, skipKeys: ReadonlySet<string>): unknown {
  if (typeof value === 'string') {
    if (value.length <= STREAM_STRING_PREVIEW_UNITS) return value
    const end = STREAM_STRING_PREVIEW_UNITS
    const lastUnit = value.charCodeAt(end - 1)
    const cut = lastUnit >= 0xd800 && lastUnit <= 0xdbff ? end - 1 : end
    const size = formatFileSize(Buffer.byteLength(value, 'utf8'))
    return `${value.slice(0, cut)}…[truncated, ${size} total]`
  }
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined
    value.forEach((item, index) => {
      const next = truncateStrings(item, PRESERVED_KEYS)
      if (next !== item) (copy ??= [...value])[index] = next
    })
    return copy ?? value
  }
  if (!isRecordLike(value)) return value
  let copy: Record<string, unknown> | undefined
  for (const [key, field] of Object.entries(value)) {
    if (skipKeys.has(key)) continue
    const next = truncateStrings(field, PRESERVED_KEYS)
    if (next !== field) (copy ??= { ...value })[key] = next
  }
  return copy ?? value
}

/**
 * Bounds an outgoing stream event so the replay buffer can persist it. Applied
 * only to the copy the writer delivers and persists; the caller keeps the full
 * event for dispatch. Long strings are cut to their head in place, so every
 * object keeps its shape. File previews, `generate_api_key` results, preserved
 * keys, and the arguments of calls the browser executes are never cut; an event
 * still too large is refused by the buffer, which ends the turn with an error.
 */
export function compactStreamEvent(event: StreamEvent): StreamEvent {
  const payload = toRecordOrNull(event.payload)
  if (!payload || 'previewPhase' in payload) return event
  if (stringUnits(payload) * 3 <= STREAM_EVENT_COMPACTION_THRESHOLD_BYTES) return event
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  if (payload.phase === MothershipStreamV1ToolPhase.result && toolName === GENERATE_API_KEY_TOOL) {
    return event
  }
  const args = isRecordLike(payload.arguments) ? payload.arguments : undefined
  const skipKeys =
    payload.phase === MothershipStreamV1ToolPhase.call && isClientExecutedToolCall(toolName, args)
      ? new Set([...PRESERVED_KEYS, 'arguments'])
      : PRESERVED_KEYS
  const compacted = truncateStrings(payload, skipKeys)
  return compacted === payload ? event : ({ ...event, payload: compacted } as StreamEvent)
}
