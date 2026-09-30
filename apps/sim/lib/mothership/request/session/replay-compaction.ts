import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
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

const NO_KEYS: ReadonlySet<string> = new Set()
const ARGUMENTS_KEY: ReadonlySet<string> = new Set(['arguments'])

/** Items kept at the head of an array that string cuts alone could not bound. */
export const STREAM_ARRAY_HEAD_ITEMS = 100

/**
 * A cheap estimate of a value's serialized size, without serializing it. It can
 * undercount strings of control characters, which JSON escapes to six bytes
 * each, but even then an event under the threshold stays under 6 / 3 × 256 KiB,
 * half the replay buffer's 1 MiB write ceiling.
 */
function estimateBytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 3 + 2
  if (Array.isArray(value))
    return value.reduce<number>((sum, item) => sum + estimateBytes(item) + 1, 2)
  if (!isRecordLike(value)) return 24
  let sum = 2
  for (const key in value) sum += key.length * 3 + 4 + estimateBytes(value[key])
  return sum
}

/**
 * Cuts long strings to a head with a readable size note, copying only what
 * changes. Every string the UI reads for identity, status, titles, or targets is
 * far shorter than the cut, and text fields keep their head, so nothing but the
 * named top-level keys is exempt.
 */
function truncateStrings(value: unknown, skipKeys: ReadonlySet<string> = NO_KEYS): unknown {
  return mapLeaves(value, skipKeys, (leaf) => {
    if (typeof leaf !== 'string' || leaf.length <= STREAM_STRING_PREVIEW_UNITS) return leaf
    const end = STREAM_STRING_PREVIEW_UNITS
    const lastUnit = leaf.charCodeAt(end - 1)
    const cut = lastUnit >= 0xd800 && lastUnit <= 0xdbff ? end - 1 : end
    const size = formatFileSize(Buffer.byteLength(leaf, 'utf8'))
    return `${leaf.slice(0, cut)}…[truncated, ${size} total]`
  })
}

/** Keeps the head of every long array, with a note of how many items were dropped. */
function trimArrays(value: unknown, skipKeys: ReadonlySet<string>): unknown {
  return mapLeaves(
    value,
    skipKeys,
    (leaf) => leaf,
    (items) =>
      items.length <= STREAM_ARRAY_HEAD_ITEMS
        ? items
        : [
            ...items.slice(0, STREAM_ARRAY_HEAD_ITEMS),
            `…[truncated, ${items.length - STREAM_ARRAY_HEAD_ITEMS} more items]`,
          ]
  )
}

/**
 * Rebuilds a value with `leaf` applied to every non-container and `array` to
 * every array, copying only what changes. `skipKeys` exempts top-level fields.
 */
function mapLeaves(
  value: unknown,
  skipKeys: ReadonlySet<string>,
  leaf: (value: unknown) => unknown,
  array: (items: unknown[]) => unknown[] = (items) => items
): unknown {
  if (Array.isArray(value)) {
    const items = array(value)
    let copy: unknown[] | undefined = items === value ? undefined : items
    items.forEach((item, index) => {
      const next = mapLeaves(item, NO_KEYS, leaf, array)
      if (next !== item) (copy ??= [...items])[index] = next
    })
    return copy ?? value
  }
  if (!isRecordLike(value)) return leaf(value)
  let copy: Record<string, unknown> | undefined
  for (const [key, field] of Object.entries(value)) {
    if (skipKeys.has(key)) continue
    const next = mapLeaves(field, NO_KEYS, leaf, array)
    if (next !== field) (copy ??= { ...value })[key] = next
  }
  return copy ?? value
}

/**
 * Bounds an outgoing stream event so the replay buffer can persist it. Applied
 * only to the copy the writer delivers and persists; the caller keeps the full
 * event for dispatch. Long strings are cut to their head in place, so every
 * object keeps its shape; if that is not enough, long arrays keep their head.
 * Assistant text, file previews, and the arguments of calls the browser
 * executes are never cut; an event
 * still too large is refused by the buffer, which ends the turn with an error.
 */
export function compactStreamEvent(event: StreamEvent): StreamEvent {
  const payload = toRecordOrNull(event.payload)
  // Text length is part of the receipt the worker and a replacement check.
  if (!payload || event.type === MothershipStreamV1EventType.text || 'previewPhase' in payload) {
    return event
  }
  if (estimateBytes(payload) <= STREAM_EVENT_COMPACTION_THRESHOLD_BYTES) return event
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  const args = isRecordLike(payload.arguments) ? payload.arguments : undefined
  const skipKeys =
    payload.phase === MothershipStreamV1ToolPhase.call && isClientExecutedToolCall(toolName, args)
      ? ARGUMENTS_KEY
      : NO_KEYS
  let compacted = truncateStrings(payload, skipKeys)
  if (Buffer.byteLength(JSON.stringify(compacted)) > STREAM_EVENT_COMPACTION_THRESHOLD_BYTES) {
    compacted = trimArrays(compacted, skipKeys)
  }
  return compacted === payload ? event : ({ ...event, payload: compacted } as StreamEvent)
}
