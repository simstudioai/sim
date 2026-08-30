import { TypeTtl } from '@sim/emcn/icons'
import { formatInstantInTimeZone } from '@/lib/core/utils/timezone'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import {
  formatDateCellDisplay,
  type NormalizeDateCellOptions,
  normalizeDateCellValue,
} from '@/lib/table/dates'
import type { ColumnDefinition } from '@/lib/table/types'

const NUMERIC_VALUE_PATTERN = /^-?\d+(?:\.\d+)?$/
const ISO_DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/i
const FRACTIONAL_SECONDS_PATTERN = /[T ]\d{1,2}:\d{2}:\d{2}\.(\d+)/i

function isRepresentableEpochSeconds(value: number): boolean {
  return Number.isSafeInteger(value) && !Number.isNaN(new Date(value * 1000).getTime())
}

/** Rounds toward the future so integer-second storage can never expire an instant early. */
function epochSecondAtOrAfter(milliseconds: number): number {
  return Math.ceil(milliseconds / 1000)
}

/** Whether an ISO-shaped input names any instant after its whole second. */
function hasFractionalSecond(value: string): boolean {
  const digits = value.match(FRACTIONAL_SECONDS_PATTERN)?.[1]
  return digits ? /[1-9]/.test(digits) : false
}

/** Converts a TTL cell input to integer Unix epoch seconds. */
export function parseTtlEpochSeconds(
  value: unknown,
  options?: NormalizeDateCellOptions
): number | null {
  if (typeof value === 'number') return isRepresentableEpochSeconds(value) ? value : null

  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isNaN(milliseconds) ? null : epochSecondAtOrAfter(milliseconds)
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (NUMERIC_VALUE_PATTERN.test(trimmed)) {
    const numeric = Number(trimmed)
    return isRepresentableEpochSeconds(numeric) ? numeric : null
  }

  const ttlOptions: NormalizeDateCellOptions = {
    ...options,
    ambiguousTime: 'later',
    offsetMinuteRounding: 'floor',
  }
  const normalized = normalizeDateCellValue(trimmed, ttlOptions)
  if (normalized === null) return null
  const instant = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalizeDateCellValue(`${normalized}T00:00:00`, ttlOptions)
    : normalized
  if (instant === null) return null
  const inputIsoDate = trimmed.match(ISO_DATE_PREFIX_PATTERN)?.[1]
  if (inputIsoDate && instant.slice(0, 10) !== inputIsoDate) return null
  const milliseconds = Date.parse(instant) + (hasFractionalSecond(trimmed) ? 1 : 0)
  if (Number.isNaN(milliseconds)) return null
  const seconds = epochSecondAtOrAfter(milliseconds)
  return isRepresentableEpochSeconds(seconds) ? seconds : null
}

function epochSecondsToIso(value: unknown): string | null {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!isRepresentableEpochSeconds(seconds)) return null
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z')
}

function epochSecondsToEditable(value: unknown, timeZone?: string): string | null {
  const iso = epochSecondsToIso(value)
  if (!iso || !timeZone) return iso
  return formatInstantInTimeZone(new Date(iso), timeZone, { offsetMinuteRounding: 'floor' })
}

export const ttlColumnType: ColumnTypeDefinition = {
  id: 'ttl',
  label: 'Expiration',
  maxPerTable: 1,
  icon: TypeTtl,
  jsonbCast: 'numeric',
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 1_706_659_200,
  ownedMetadata: [],
  workflowInputType: 'number',
  editor: 'date',
  expandable: false,
  typeaheadPattern: /[\d\-/]/,
  parseErrorMessage: 'Invalid expiration date',

  coerce(value, _column, context) {
    const seconds = parseTtlEpochSeconds(value, context)
    return seconds === null ? { ok: false } : { ok: true, value: seconds }
  },

  valueForConversion(value, target: ColumnDefinition) {
    if (target.type !== 'date') return value
    return epochSecondsToIso(value) ?? value
  },

  validateCell(value, column) {
    return typeof value === 'number' && isRepresentableEpochSeconds(value)
      ? null
      : `${column.name} must be valid epoch seconds`
  },

  formatForDisplay(value) {
    const iso = epochSecondsToIso(value)
    return iso === null ? String(value) : formatDateCellDisplay(iso, { seconds: true })
  },

  formatForInput(value, _column, context) {
    return epochSecondsToEditable(value, context?.timezone) ?? String(value)
  },
}
