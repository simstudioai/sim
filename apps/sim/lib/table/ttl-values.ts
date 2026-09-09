export const TTL_FORMAT_ERROR =
  'Expiration must be an ISO timestamp with Z or an explicit UTC offset (for example, 2026-09-07T14:30:00-07:00), with at most 6 fractional second digits'

/** Shared JavaScript/PostgreSQL shape guard; numeric offsets fit PostgreSQL's supported range. */
export const TTL_TIMESTAMP_PATTERN =
  '^((?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]))[Tt]((?:0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])(?::([0-5][0-9])(?:[.]([0-9]{1,6}))?)?([Zz]|[+-](?:0[0-9]|1[0-5]):[0-5][0-9])$'

const TTL_TIMESTAMP_REGEX = new RegExp(TTL_TIMESTAMP_PATTERN)

function parseTtlTimestamp(value: unknown) {
  if (typeof value !== 'string') return null
  const match = TTL_TIMESTAMP_REGEX.exec(value)
  if (!match) return null

  const [, day, time, second, fractionalSecond, offset] = match
  const wallClock = `${day}T${time}:${second ?? '00'}`
  const wallMilliseconds = Date.parse(`${wallClock}Z`)
  if (
    !Number.isFinite(wallMilliseconds) ||
    new Date(wallMilliseconds).toISOString() !== `${wallClock}.000Z`
  ) {
    return null
  }

  const instant = new Date(`${wallClock}${offset.toUpperCase()}`)
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.getUTCFullYear() < 1 ||
    instant.getUTCFullYear() > 9999
  ) {
    return null
  }
  const fraction = (fractionalSecond ?? '').replace(/0+$/, '')
  return {
    wallClock,
    fraction: fraction ? `.${fraction}` : '',
    offset: offset.toUpperCase() === 'Z' ? '-00:00' : offset,
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
