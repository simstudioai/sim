import { TypeEmail } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

/**
 * Deliberately permissive, and deliberately not RFC 5322.
 *
 * A column type's `coerce` is the write path: rejecting means the cell is
 * nulled, so an address this cannot parse is data the user loses on paste or
 * CSV import. The only shapes worth refusing are the ones that are certainly
 * not addresses — no `@`, whitespace inside, a missing local part or domain, or
 * a dotless domain. Everything else is stored as typed.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export const emailColumnType: ColumnTypeDefinition = {
  id: 'email',
  label: 'Email',
  icon: TypeEmail,
  // Stored as plain text; comparison and sorting are lexical, like `string`.
  jsonbCast: null,
  orderable: true,
  storesOpaqueIds: false,
  supportsUnique: true,
  sampleValue: 'person@example.com',
  ownedMetadata: ownedKeysOf('email'),
  workflowInputType: 'string',
  editor: 'text',
  expandable: false,
  parseErrorMessage: 'Invalid email address',

  coerce(value) {
    if (typeof value !== 'string') return { ok: false }
    // Addresses arrive padded from spreadsheets and CSVs, and case-folded is
    // the form every downstream match wants — enrichment cascades key on this
    // column, and `Ada@Example.com` must not miss `ada@example.com`.
    const normalized = value.trim().toLowerCase()
    if (normalized === '') return { ok: true, value: '' }
    return EMAIL_PATTERN.test(normalized) ? { ok: true, value: normalized } : { ok: false }
  },

  validateCell(value, column) {
    if (typeof value !== 'string') return `${column.name} must be an email address`
    if (value === '') return null
    return EMAIL_PATTERN.test(value) ? null : `${column.name} must be a valid email address`
  },

  formatForDisplay(value) {
    return typeof value === 'string' ? value : ''
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : ''
  },
}
