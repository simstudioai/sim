import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import { getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/mothership/request/session/types'
import { isClientExecutedToolCall } from '@/lib/mothership/tools/client-executed-tools'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'

/**
 * Payloads whose strings could serialize past this are compacted before they are
 * persisted and delivered; well under the replay buffer's 1 MiB write ceiling.
 */
export const STREAM_EVENT_COMPACTION_THRESHOLD_BYTES = 256 * 1024

/** Room left in a replay write for the envelope around an event's payload. */
const ENVELOPE_HEADROOM_BYTES = 16 * 1024

/** The largest serialized payload the replay buffer can persist in one write. */
export const STREAM_EVENT_MAX_PAYLOAD_BYTES =
  getRedisBudgetLimits('copilot_stream').maxSingleWriteBytes - ENVELOPE_HEADROOM_BYTES

/** UTF-16 units kept at the head of a long string. */
export const STREAM_STRING_PREVIEW_UNITS = 8 * 1024

const NO_KEYS: ReadonlySet<string> = new Set()
const ARGUMENTS_KEY: ReadonlySet<string> = new Set(['arguments'])

/** Items kept at the head of an array that string cuts alone could not bound. */
const STREAM_ARRAY_HEAD_ITEMS = 100

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
function truncateStrings(value: unknown, skipKeys: ReadonlySet<string>): unknown {
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

/** A field must be at least this large to be omitted as a last resort. */
const OMITTABLE_FIELD_MIN_BYTES = 64 * 1024

/**
 * The exact UTF-8 size of `JSON.stringify(value)`, computed bottom-up without
 * building the string. `sizes` memoizes containers so a caller can ask about
 * every node of one tree in a single linear pass.
 */
export function serializedBytes(value: unknown, sizes = new WeakMap<object, number>()): number {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
  }
  const cached = sizes.get(value)
  if (cached !== undefined) return cached
  let bytes = 2
  let members = 0
  if (Array.isArray(value)) {
    for (const item of value) {
      bytes += isSkippedByJson(item) ? 4 : serializedBytes(item, sizes)
      members++
    }
  } else {
    for (const [key, field] of Object.entries(value)) {
      if (isSkippedByJson(field)) continue
      bytes += Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + serializedBytes(field, sizes)
      members++
    }
  }
  bytes += Math.max(members - 1, 0)
  sizes.set(value, bytes)
  return bytes
}

/** Values JSON leaves out of an object, or writes as `null` in an array. */
function isSkippedByJson(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol'
}

function omissionNote(bytes: number): string {
  return `…[omitted, ${formatFileSize(bytes)} total]`
}

type Sized = { key: string | number; value: unknown; bytes: number }

/**
 * Removes at least `need` serialized bytes from `value`, replacing as little as
 * possible with size notes. Among the children larger than the omission floor,
 * it recurses into the smallest one that alone covers what is still needed, so
 * that subtree's siblings survive; failing that it replaces the largest whole
 * and looks again. A nested node whose large parts cannot cover the need, or
 * that has none, is replaced whole; the payload itself (`top`) never is. One
 * pass over sizes that are each computed once.
 */
function shed(
  value: unknown,
  need: number,
  sizes: WeakMap<object, number>,
  skipKeys: ReadonlySet<string>,
  top = false
): unknown {
  const bytes = serializedBytes(value, sizes)
  const isContainer = Array.isArray(value) || isRecordLike(value)
  if (!top && (!isContainer || bytes <= OMITTABLE_FIELD_MIN_BYTES)) return omissionNote(bytes)
  const entries: Array<[string | number, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : isRecordLike(value)
      ? Object.entries(value).filter(([key]) => !skipKeys.has(key))
      : []
  // Only children over the floor are candidates; if they cannot cover the need,
  // a nested node is replaced whole, its own identity fields included.
  const children: Sized[] = entries
    .map(([key, child]) => ({ key, value: child, bytes: serializedBytes(child, sizes) }))
    .filter((child) => child.bytes > OMITTABLE_FIELD_MIN_BYTES)
    .sort((left, right) => right.bytes - left.bytes)
  if (children.length === 0) return top ? value : omissionNote(bytes)

  const gain = (child: Sized) => child.bytes - serializedBytes(omissionNote(child.bytes))
  const replacements = new Map<string | number, unknown>()
  let remaining = need
  for (let index = 0; index < children.length && remaining > 0; index++) {
    // Children are sorted largest first, so if this one cannot cover the rest, none can.
    if (gain(children[index]) >= remaining) {
      let sufficient = children[index]
      for (let candidate = children.length - 1; candidate > index; candidate--) {
        if (gain(children[candidate]) >= remaining) {
          sufficient = children[candidate]
          break
        }
      }
      replacements.set(sufficient.key, shed(sufficient.value, remaining, sizes, NO_KEYS))
      remaining = 0
    } else {
      replacements.set(children[index].key, omissionNote(children[index].bytes))
      remaining -= gain(children[index])
    }
  }
  // A caller picks a nested node because replacing it whole covers the need.
  if (remaining > 0 && !top) return omissionNote(bytes)

  if (Array.isArray(value)) {
    return value.map((item, index) => (replacements.has(index) ? replacements.get(index) : item))
  }
  const copy = { ...toRecordOrNull(value) }
  for (const [key, replacement] of replacements) copy[String(key)] = replacement
  return copy
}

/**
 * Bounds an outgoing stream event so the replay buffer can persist it. Applied
 * only to the copy the writer delivers and persists; the caller keeps the full
 * event for dispatch. Long strings are cut to their head in place, so every
 * object keeps its shape; if that is not enough, long arrays keep their head,
 * and past one replay write the smallest sufficient bulk is replaced by a size
 * note, keeping the fields beside it. Assistant text, the arguments of calls the
 * browser executes, and preview content and completions are never cut: the
 * client applies preview content as exact deltas, and the preview adapter
 * bounds both itself. An event still too large is refused by the buffer, which
 * ends the turn with an error.
 */
export function compactStreamEvent(event: StreamEvent): StreamEvent {
  const payload = toRecordOrNull(event.payload)
  // Text length is part of the receipt the worker and a replacement check.
  if (
    !payload ||
    event.type === MothershipStreamV1EventType.text ||
    payload.previewPhase === 'file_preview_content' ||
    payload.previewPhase === 'file_preview_complete'
  ) {
    return event
  }
  if (estimateBytes(payload) <= STREAM_EVENT_COMPACTION_THRESHOLD_BYTES) return event
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
  const args = isRecordLike(payload.arguments) ? payload.arguments : undefined
  const skipKeys =
    payload.phase === MothershipStreamV1ToolPhase.call && isClientExecutedToolCall(toolName, args)
      ? ARGUMENTS_KEY
      : NO_KEYS
  const sizes = new WeakMap<object, number>()
  let compacted = truncateStrings(payload, skipKeys)
  if (serializedBytes(compacted, sizes) > STREAM_EVENT_COMPACTION_THRESHOLD_BYTES) {
    compacted = trimArrays(compacted, skipKeys)
  }
  const bytes = serializedBytes(compacted, sizes)
  if (bytes > STREAM_EVENT_MAX_PAYLOAD_BYTES) {
    compacted = shed(compacted, bytes - STREAM_EVENT_MAX_PAYLOAD_BYTES, sizes, skipKeys, true)
  }
  return compacted === payload ? event : ({ ...event, payload: compacted } as StreamEvent)
}
