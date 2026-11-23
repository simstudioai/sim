/**
 * The expiration (`ttl`) column's date-picker helpers: split a stored timestamp into the picker's
 * day, time and offset, join them back, and name today in that offset. The timestamp format itself
 * lives in `@sim/table-cells/ttl`, shared with the CLI's offline row check.
 */

import { normalizeTtlTimestamp } from '@sim/table-cells/ttl'

/** Serializes picker fields in their existing offset. A day alone means midnight in that offset. */
export function ttlValueFromPicker(day: string, time: string | null, offset = '-00:00'): string {
  const seconds = time ? (time.length === 5 ? `${time}:00` : time) : '00:00:00'
  return `${day}T${seconds}${offset}`
}

/** Reads the stored clock and offset for the picker without converting the instant. */
export function ttlValueToPickerParts(value: string): {
  day: string | null
  time: string | null
  offset: string
} {
  const normalized = normalizeTtlTimestamp(value)
  return normalized
    ? { day: normalized.slice(0, 10), time: normalized.slice(11, -6), offset: normalized.slice(-6) }
    : { day: null, time: null, offset: '-00:00' }
}

/** Today's calendar date in a fixed numeric offset, independent of profile timezone settings. */
export function todayAtTtlOffset(offset: string): string {
  const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))
  const signedMinutes = offset.startsWith('-') ? -minutes : minutes
  return new Date(Date.now() + signedMinutes * 60_000).toISOString().slice(0, 10)
}
