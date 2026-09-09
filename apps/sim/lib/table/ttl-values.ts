export const TTL_FORMAT_ERROR =
  'Expiration must be an ISO timestamp with Z or an explicit UTC offset (for example, 2026-09-07T14:30:00-07:00), with at most 6 fractional second digits'

/** Shared JavaScript/PostgreSQL shape guard; numeric offsets fit PostgreSQL's supported range. */
export const TTL_TIMESTAMP_PATTERN =
  '^((?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]))[Tt]((?:0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])(?::([0-5][0-9])(?:[.]([0-9]{1,6}))?)?([Zz]|[+-](?:0[0-9]|1[0-5]):[0-5][0-9])$'

const TTL_TIMESTAMP_REGEX = new RegExp(TTL_TIMESTAMP_PATTERN)

/** Normalizes explicit instants to UTC without losing PostgreSQL's microsecond precision. */
export function normalizeTtlTimestamp(value: unknown): string | null {
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
  return `${instant.toISOString().slice(0, -5)}${fraction ? `.${fraction}` : ''}Z`
}

/** Whether a value names a real instant with an explicit offset. */
export function isTtlTimestamp(value: unknown): value is string {
  return normalizeTtlTimestamp(value) !== null
}

/** Serializes literal UTC picker fields without timezone conversion. A day alone means midnight. */
export function ttlValueFromPicker(day: string, time: string | null): string {
  const seconds = time ? (time.length === 5 ? `${time}:00` : time) : '00:00:00'
  return `${day}T${seconds}Z`
}

/** Converts an explicit instant to the UTC fields used by the picker. */
export function ttlValueToPickerParts(value: string): { day: string | null; time: string | null } {
  const normalized = normalizeTtlTimestamp(value)
  return normalized
    ? { day: normalized.slice(0, 10), time: normalized.slice(11, -1) }
    : { day: null, time: null }
}
