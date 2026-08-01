import { TypePhone } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

/** E.164 allows 1–15 digits; require 7 so a stray year or zip is not a number. */
const MIN_DIGITS = 7
const MAX_DIGITS = 15

/**
 * Strips the punctuation a phone number is written with, keeping a leading `+`.
 *
 * Returns null when what is left cannot be a phone number. Extensions are
 * deliberately not parsed — `x123` has no E.164 representation, so a value
 * carrying one is refused rather than silently truncated to the wrong number.
 */
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  const hasPlus = trimmed.startsWith('+')
  const rest = hasPlus ? trimmed.slice(1) : trimmed
  // Anything that is not a digit or a conventional separator means this is not
  // a bare phone number — an extension, a second number, a note.
  if (!/^[\d\s\-().]*$/.test(rest)) return null
  const digits = rest.replace(/\D/g, '')
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null
  return `${hasPlus ? '+' : ''}${digits}`
}

export const phoneColumnType: ColumnTypeDefinition = {
  id: 'phone',
  label: 'Phone',
  icon: TypePhone,
  // Stored as text: a phone number is an identifier, not a quantity. Casting to
  // numeric would drop the leading `+` and any leading zero.
  jsonbCast: null,
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: '+15551234567',
  ownedMetadata: ownedKeysOf('phone'),
  workflowInputType: 'string',
  editor: 'text',
  expandable: false,
  typeaheadPattern: /[\d+\s\-().]/,
  parseErrorMessage: 'Invalid phone number',

  coerce(value) {
    // A number reaches here from a CSV whose phone column was read as numeric.
    // `String(value)` is right for an integer; a float means it was never a
    // phone number, and exponent notation would normalize into nonsense.
    if (typeof value === 'number') {
      // Negative is refused, not stripped: `String(-15551234567)` would have
      // its `-` eaten as a separator and be stored as a valid positive number
      // the caller never wrote.
      if (!Number.isInteger(value) || value < 0) return { ok: false }
      const normalized = normalizePhone(String(value))
      return normalized === null ? { ok: false } : { ok: true, value: normalized }
    }
    if (typeof value !== 'string') return { ok: false }
    const normalized = normalizePhone(value)
    return normalized === null ? { ok: false } : { ok: true, value: normalized }
  },

  validateCell(value, column) {
    if (typeof value !== 'string') return `${column.name} must be a phone number`
    if (value === '') return null
    return normalizePhone(value) === null ? `${column.name} must be a valid phone number` : null
  },

  formatForDisplay(value) {
    return typeof value === 'string' ? value : ''
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : ''
  },
}
