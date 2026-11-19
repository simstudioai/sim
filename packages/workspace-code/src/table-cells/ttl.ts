import { z } from 'zod'

export const TTL_FORMAT_ERROR =
  'Expiration must be an ISO timestamp with Z or an explicit UTC offset (for example, 2026-09-07T14:30:00-07:00), with at most 6 fractional second digits'

/** Zod owns the ISO format; SQL also checks native timestamptz validity before casting. */
export const TTL_TIMESTAMP_VALIDATION = {
  pattern: z.regexes.datetime({ offset: true }).source,
  maxFractionDigits: 6,
} as const

const timestampSchema = z.iso.datetime({ offset: true })

function parseTtlTimestamp(value: unknown) {
  if (typeof value !== 'string' || value !== value.trim()) return null
  const result = timestampSchema.safeParse(value.toUpperCase())
  if (!result.success) return null

  const timestamp = result.data
  const offset = timestamp.endsWith('Z') ? 'Z' : timestamp.slice(-6)
  const [dateTime, fractionalSecond = ''] = timestamp.slice(0, -offset.length).split('.')
  if (
    timestamp.startsWith('0000-') ||
    (offset !== 'Z' && Number(offset.slice(1, 3)) > 15) ||
    fractionalSecond.length > TTL_TIMESTAMP_VALIDATION.maxFractionDigits
  ) {
    return null
  }

  const wallClock = dateTime.length === 16 ? `${dateTime}:00` : dateTime
  const instant = new Date(`${wallClock}${offset}`)
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.getUTCFullYear() < 1 ||
    instant.getUTCFullYear() > 9999
  ) {
    return null
  }
  const fraction = fractionalSecond.replace(/0+$/, '')
  return {
    wallClock,
    fraction: fraction ? `.${fraction}` : '',
    offset: offset === 'Z' ? '-00:00' : offset,
    instant,
  }
}

/** Preserves the supplied clock and offset, spelling Z as -00:00, without losing microseconds. */
export function normalizeTtlTimestamp(value: unknown): string | null {
  const parsed = parseTtlTimestamp(value)
  return parsed ? `${parsed.wallClock}${parsed.fraction}${parsed.offset}` : null
}

/** An instant-only comparison value; never used to rewrite the stored offset. */
export function ttlInstantForComparison(value: unknown): string | null {
  const parsed = parseTtlTimestamp(value)
  return parsed ? `${parsed.instant.toISOString().slice(0, -5)}${parsed.fraction}Z` : null
}

/** Whether a value names a real instant with an explicit offset. */
export function isTtlTimestamp(value: unknown): value is string {
  return normalizeTtlTimestamp(value) !== null
}

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
