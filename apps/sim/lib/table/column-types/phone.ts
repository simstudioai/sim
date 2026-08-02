import { TypePhone } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

/**
 * E.164 caps a number at 15 digits including the country code. The floor is
 * ours: the standard allows shorter national numbers, but anything under 7
 * digits in a spreadsheet column is far more often a year, a zip, or an ID that
 * landed in the wrong column than a real number — and silently accepting those
 * is worse than making the user confirm.
 */
const MIN_DIGITS = 7
const MAX_DIGITS = 15

/**
 * The punctuation a phone number is legitimately written with. Anything else —
 * a letter, a comma, a slash, an `x` — means the value is not a single bare
 * number: it is an extension, a second number, or a note.
 */
const SEPARATORS = /^[\d\s\-().]*$/

/**
 * Strips a written number to its digits, keeping a leading `+`.
 *
 * Returns `''` for an empty input (absence, which `required` judges) and `null`
 * for anything that is not a single phone number.
 *
 * Extensions are refused rather than truncated: `555-1234 x89` has no E.164
 * representation, and dropping the `x89` would store a number that reaches a
 * different person than the one the user wrote.
 */
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return ''

  const hasPlus = trimmed.startsWith('+')
  const rest = hasPlus ? trimmed.slice(1) : trimmed
  if (!SEPARATORS.test(rest)) return null

  const digits = rest.replace(/\D/g, '')
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null

  // An explicit `+` claims E.164, where the country code never starts with 0.
  // `+0123456789` is not a number any network can route, so it is refused
  // rather than stored as though it were international.
  //
  // Whether those leading digits form a country code that actually EXISTS is
  // not checked: that needs a maintained country-code table, which goes stale
  // and then starts rejecting valid numbers. The first-digit rule is the cheap
  // check that catches the real mistakes.
  if (hasPlus && digits.startsWith('0')) return null

  // Without a `+` the value is a national number, where a leading zero is a
  // normal trunk prefix (UK `020…`, DE `030…`) and must be preserved.
  return `${hasPlus ? '+' : ''}${digits}`
}

export const phoneColumnType: ColumnTypeDefinition = {
  id: 'phone',
  label: 'Phone',
  icon: TypePhone,
  // Stored as text: a phone number is an identifier, not a quantity. Casting to
  // numeric would drop the leading `+` and any leading zero.
  jsonbCast: null,
  canonicalizesValues: true,
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
    if (typeof value === 'number') {
      // Negative is refused, not stripped: `String(-15551234567)` would have its
      // `-` eaten as a separator and be stored as a valid positive number the
      // caller never wrote. A non-integer was never a phone number, and an
      // UNSAFE integer has already lost digits to float64 before we see it —
      // storing it would silently record a different number.
      if (!Number.isSafeInteger(value) || value < 0) return { ok: false }
      const normalized = normalizePhone(String(value))
      return normalized === null ? { ok: false } : { ok: true, value: normalized }
    }
    if (typeof value !== 'string') return { ok: false }
    const normalized = normalizePhone(value)
    return normalized === null ? { ok: false } : { ok: true, value: normalized }
  },

  validateCell(value, column) {
    if (typeof value !== 'string') return `${column.name} must be a phone number`
    // An empty cell is absence, not an invalid number — `required` judges it.
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
