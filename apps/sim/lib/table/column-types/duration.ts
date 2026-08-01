import { TypeDuration } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

/** Guard against `Infinity` and absurd values that would format unreadably. */
const MAX_SECONDS = 100 * 365 * 24 * 60 * 60

/** `1h 30m`, `90m`, `45s`, `2h15m` — the unit-suffixed shorthand. */
const UNIT_PATTERN = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/i

/**
 * Parses a duration into seconds, or null when it is not one.
 *
 * Accepts the three shapes a duration is written in: a bare number of seconds,
 * clock notation (`h:mm:ss` or `mm:ss`), and unit shorthand (`1h 30m`). All
 * three arrive in practice — a CSV exports seconds, a person types clock
 * notation, an LLM writes shorthand — and rejecting any of them would null the
 * cell on write.
 */
function parseDuration(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS ? value : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length > 3) return null
    const nums = parts.map((p) => (p.trim() === '' ? Number.NaN : Number(p)))
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null
    // Right-aligned, so `mm:ss` and `h:mm:ss` share one reduction: seconds are
    // always last. Only the leading field may exceed its base — `90:00` is 90
    // minutes, which is exactly how people write it.
    const seconds = nums.reduce((total, n) => total * 60 + n, 0)
    if (nums.slice(1).some((n) => n >= 60)) return null
    return seconds <= MAX_SECONDS ? seconds : null
  }

  const bare = Number(trimmed)
  if (Number.isFinite(bare)) {
    return bare >= 0 && bare <= MAX_SECONDS ? bare : null
  }

  const match = UNIT_PATTERN.exec(trimmed)
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    return null
  }
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  return seconds <= MAX_SECONDS ? seconds : null
}

/** Seconds → `h:mm:ss`, dropping the hours field when there are none. */
function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const seconds = rounded % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}

export const durationColumnType: ColumnTypeDefinition = {
  id: 'duration',
  label: 'Duration',
  icon: TypeDuration,
  // Stored as a bare number of seconds, so filters and sorts compare
  // numerically and `>= 1h` is a plain numeric range — which is the whole
  // reason this is not just formatted text.
  jsonbCast: 'numeric',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 5400,
  ownedMetadata: ownedKeysOf('duration'),
  workflowInputType: 'number',
  editor: 'text',
  expandable: false,
  inputMode: 'decimal',
  acceptsFormattedInput: true,
  typeaheadPattern: /[\d:.hms\s]/i,
  parseErrorMessage: 'Invalid duration',

  coerce(value) {
    const parsed = parseDuration(value)
    return parsed === null ? { ok: false } : { ok: true, value: parsed }
  },

  isCompatibleWith(value) {
    // Stricter than `coerce` on the same grounds `date` is. Reading a whole
    // NUMBER column as seconds is a guess about what those numbers meant, and
    // it is not reversible once the column renders as `0:05`. A single write
    // still accepts a number, where the caller means seconds explicitly.
    if (typeof value === 'number') return false
    return parseDuration(value) !== null
  },

  validateCell(value, column) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? null
      : `${column.name} must be a duration in seconds`
  },

  formatForDisplay(value) {
    return typeof value === 'number' ? formatDuration(value) : ''
  },

  // Edited in the same clock notation it displays, so a cell round-trips
  // through the editor unchanged.
  formatForInput(value) {
    return typeof value === 'number' ? formatDuration(value) : ''
  },
}
