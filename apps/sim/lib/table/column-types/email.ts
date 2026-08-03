import { TypeEmail } from '@sim/emcn/icons'
import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import { ownedKeysOf } from '@/lib/table/column-types/types'

/**
 * Length limits from RFC 5321 §4.5.3.1. Enforced because the pattern alone
 * cannot: without them a 10,000-character "address" is well-formed, and it
 * would be stored, indexed, and sent to every downstream consumer.
 */
const MAX_EMAIL_LENGTH = 254
const MAX_LOCAL_LENGTH = 64
const MAX_DOMAIN_LENGTH = 253
const MAX_LABEL_LENGTH = 63

/**
 * The RFC 5322 **dot-atom** local part: one or more `atext` runs joined by
 * single dots.
 *
 * `atext` is the unquoted-address character set. Restricting to it is what
 * rejects the shapes the old `[^\s@]+` accepted — a comma or semicolon (which
 * means the cell actually holds a LIST of addresses, not one), a backslash or
 * quote, and a bracket. Requiring runs between the dots is what rejects
 * `a..b@x.com`, `.a@x.com`, and `a.@x.com`.
 *
 * Quoted local parts (`"a b"@example.com`) are legal and deliberately refused:
 * they are vanishingly rare in practice, and admitting them would mean carrying
 * quoting rules through case-folding, comparison, and every downstream match.
 */
const ATEXT = String.raw`[A-Za-z0-9!#$%&'*+/=?^_\`{|}~-]`
const LOCAL_PART = new RegExp(`^${ATEXT}+(?:\\.${ATEXT}+)*$`)

/**
 * One DNS label: alphanumeric at both ends, hyphens only in between. Rejects
 * `-example.com` and `example-.com`, which the old pattern allowed.
 */
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

/** A TLD is alphabetic and at least two characters — never numeric. */
const TLD = /^[A-Za-z]{2,}$/

/**
 * Whether `value` is an address worth storing.
 *
 * Deliberately stricter than the old check but still short of full RFC 5322:
 * the goal is to reject what is certainly not a single address, not to admit
 * every exotic form the grammar permits. An address that fails here is refused
 * on write rather than stored, so the user is told immediately instead of
 * discovering it when an enrichment or a send silently skips the row.
 */
function isValidEmail(value: string): boolean {
  if (value.length > MAX_EMAIL_LENGTH) return false

  // Split on the LAST `@`: `atext` excludes `@`, so any earlier one means the
  // value is malformed rather than a local part containing it.
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return false

  const local = value.slice(0, at)
  const domain = value.slice(at + 1)

  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) return false
  if (domain.length > MAX_DOMAIN_LENGTH) return false

  // A bare hostname is not deliverable and is nearly always a typo for a real
  // domain, so at least one dot is required.
  const labels = domain.split('.')
  if (labels.length < 2) return false
  if (!labels.every((label) => label.length <= MAX_LABEL_LENGTH && DNS_LABEL.test(label))) {
    return false
  }
  return TLD.test(labels[labels.length - 1])
}

export const emailColumnType: ColumnTypeDefinition = {
  id: 'email',
  label: 'Email',
  icon: TypeEmail,
  // Stored as plain text; comparison and sorting are lexical, like `string`.
  jsonbCast: null,
  canonicalizesValues: true,
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
    //
    // Folding the DOMAIN is unambiguously safe (DNS is case-insensitive). The
    // local part is technically case-SENSITIVE per RFC 5321, but no mail
    // provider in practice treats it so, and storing one canonical form is what
    // makes `unique` on this column mean what a user expects.
    const normalized = value.trim().toLowerCase()
    if (normalized === '') return { ok: true, value: '' }
    return isValidEmail(normalized) ? { ok: true, value: normalized } : { ok: false }
  },

  validateCell(value, column) {
    if (typeof value !== 'string') return `${column.name} must be an email address`
    // An empty cell is absence, not an invalid address — `required` is what
    // rejects it, consistently with every other text-shaped type.
    if (value === '') return null
    return isValidEmail(value) ? null : `${column.name} must be a valid email address`
  },

  formatForDisplay(value) {
    return typeof value === 'string' ? value : ''
  },

  formatForInput(value) {
    return typeof value === 'string' ? value : ''
  },
}
