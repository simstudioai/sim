/**
 * The metadata keys connectors use for the source's last-modified time, in
 * the order they are tried. Connectors were never asked to agree on a name,
 * so the persisted column is derived here rather than in each of them.
 */
const SOURCE_MODIFIED_AT_KEYS = [
  'modifiedTime',
  'updatedTime',
  'lastModified',
  'lastModifiedDateTime',
  'modifiedAt',
  'modified_at',
  'lastUpdated',
  'updatedAt',
  'updated_at',
  'updated',
  /** JSM requests: the time the request last changed status, the list endpoint's only change signal. */
  'statusDate',
  /** Google Chat spaces and Teams channels: the latest message time, the listing's only change signal. */
  'lastActivity',
] as const

/** Earlier than any plausible document; guards against epoch-zero placeholders. */
const EARLIEST_PLAUSIBLE_MS = Date.UTC(1990, 0, 1)
/** A source clock a day ahead is skew; further ahead is a placeholder. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** A `Date` only when it holds a real instant; a finite number outside the Date range yields an invalid one. */
function validDate(date: Date): Date | null {
  return Number.isNaN(date.getTime()) ? null : date
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return validDate(value)
  if (typeof value === 'number' && Number.isFinite(value)) {
    /** Seconds-since-epoch values are far too small to be milliseconds after 1990. */
    return validDate(new Date(value < 1e11 ? value * 1000 : value))
  }
  if (typeof value === 'string' && value.trim()) return validDate(new Date(value))
  return null
}

/**
 * The source's last-modified time from a connector's document metadata, or
 * null when it reports none or the value is not a plausible timestamp.
 */
export function resolveSourceModifiedAt(
  metadata: Record<string, unknown> | undefined,
  now: Date = new Date()
): Date | null {
  if (!metadata) return null
  for (const key of SOURCE_MODIFIED_AT_KEYS) {
    if (!(key in metadata)) continue
    const parsed = toDate(metadata[key])
    if (!parsed) continue
    const ms = parsed.getTime()
    if (ms < EARLIEST_PLAUSIBLE_MS || ms > now.getTime() + FUTURE_TOLERANCE_MS) continue
    return parsed
  }
  return null
}
