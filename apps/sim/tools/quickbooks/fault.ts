import { truncate } from '@sim/utils/string'

/**
 * Maximum number of `Fault.Error` entries retained from a QuickBooks response.
 * Intuit does not bound the array, so an unbounded concatenation would let a
 * remote response dictate the size of the thrown error message.
 */
const QUICKBOOKS_MAX_FAULT_ERRORS = 5

const QUICKBOOKS_MAX_FAULT_FIELD_CHARS = 500

/** Documented Intuit fault fields retained during sanitization. */
const QUICKBOOKS_FAULT_FIELDS = ['code', 'Message', 'Detail', 'element'] as const

/**
 * Documented `Fault.type` classifications, which separate a rejected payload
 * from an expired or unauthorized token. Intuit's own pages render these both
 * with and without the `Fault` suffix — `type="ValidationFault"` in one sample,
 * `type="Validation"` in another — so they are matched by prefix and reported
 * under a single spelling.
 */
const QUICKBOOKS_FAULT_TYPES = ['Authentication', 'Authorization', 'Validation', 'System'] as const

function normalizeQuickBooksFaultType(value: unknown): string | undefined {
  const type = typeof value === 'string' ? value.trim() : ''
  if (!type) return undefined
  const known = QUICKBOOKS_FAULT_TYPES.find((candidate) => type.startsWith(candidate))
  return known ? `${known}Fault` : truncate(type, QUICKBOOKS_MAX_FAULT_FIELD_CHARS, '')
}

/**
 * Intuit error code and message for an outdated `SyncToken`.
 * @see Fault sample `{"Message": "Stale Object Error", "code": "5010"}`
 */
const QUICKBOOKS_STALE_OBJECT_CODE = '5010'
const QUICKBOOKS_STALE_OBJECT_MESSAGE = 'stale object error'

const QUICKBOOKS_STALE_OBJECT_GUIDANCE =
  'Re-read the record to obtain its current SyncToken, then retry the write.'

export interface SanitizedQuickBooksFault {
  Fault: {
    Error: Array<Record<string, string>>
    /** Documented Intuit fault classification, normalized by prefix. */
    type?: string
    /**
     * Count of `Error` entries dropped by {@link QUICKBOOKS_MAX_FAULT_ERRORS}.
     * Preserved across repeated sanitization so a value that round-trips
     * through an error payload does not lose or double-count omissions.
     */
    omittedErrorCount?: number
  }
}

/**
 * Extracts the documented Intuit fault fields from an arbitrary response body,
 * discarding everything else so unvetted remote content never reaches an error
 * message. Entry count and per-field length are both bounded.
 *
 * Returns `null` when `data` carries no usable fault, which callers treat as
 * "this response is not a fault".
 */
export function sanitizeQuickBooksFaultData(data: unknown): SanitizedQuickBooksFault | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const fault = (data as Record<string, unknown>).Fault
  if (!fault || typeof fault !== 'object' || Array.isArray(fault)) return null
  const errors = (fault as Record<string, unknown>).Error
  if (!Array.isArray(errors)) return null

  const sanitizedErrors: Array<Record<string, string>> = []
  let usableErrorCount = 0
  for (const entry of errors) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const value = entry as Record<string, unknown>
    const sanitized = Object.fromEntries(
      QUICKBOOKS_FAULT_FIELDS.flatMap((key) => {
        const field = typeof value[key] === 'string' ? value[key].trim() : ''
        return field ? [[key, truncate(field, QUICKBOOKS_MAX_FAULT_FIELD_CHARS, '')]] : []
      })
    )
    if (Object.keys(sanitized).length === 0) continue
    usableErrorCount += 1
    if (sanitizedErrors.length < QUICKBOOKS_MAX_FAULT_ERRORS) {
      sanitizedErrors.push(sanitized)
    }
  }
  if (usableErrorCount === 0) return null

  const priorOmitted = (fault as Record<string, unknown>).omittedErrorCount
  const carriedOmitted = typeof priorOmitted === 'number' && priorOmitted > 0 ? priorOmitted : 0
  const omittedErrorCount = carriedOmitted + Math.max(0, usableErrorCount - sanitizedErrors.length)

  const type = normalizeQuickBooksFaultType((fault as Record<string, unknown>).type)

  return {
    Fault: {
      Error: sanitizedErrors,
      ...(type ? { type } : {}),
      ...(omittedErrorCount > 0 ? { omittedErrorCount } : {}),
    },
  }
}

function hasQuickBooksStaleObjectError(fault: SanitizedQuickBooksFault): boolean {
  return fault.Fault.Error.some(
    (error) =>
      error.code?.trim() === QUICKBOOKS_STALE_OBJECT_CODE ||
      error.Message?.trim().toLowerCase() === QUICKBOOKS_STALE_OBJECT_MESSAGE
  )
}

/**
 * Renders a sanitized fault as a single human-readable detail string.
 *
 * The documented fault classification leads, then each entry becomes
 * `code: Message: Detail (element)`. Entries dropped by the
 * sanitizer are reported as a trailing count, and a stale-`SyncToken` fault
 * gains explicit remediation guidance because retrying is never correct.
 */
export function formatQuickBooksFaultDetail(fault: SanitizedQuickBooksFault): string {
  const details = fault.Fault.Error.map((error) => {
    const code = error.code?.trim() ?? ''
    const message = error.Message?.trim() ?? ''
    const detail = error.Detail?.trim() ?? ''
    const element = error.element?.trim() ?? ''
    const text = [message, detail].filter(Boolean).join(': ')
    const prefixed = code && text ? `${code}: ${text}` : code || text
    if (!prefixed && !element) return ''
    if (!element) return prefixed
    return prefixed ? `${prefixed} (element: ${element})` : `element: ${element}`
  }).filter(Boolean)

  const omitted = fault.Fault.omittedErrorCount ?? 0
  return [
    details.length > 0 && fault.Fault.type ? `${fault.Fault.type}:` : '',
    details.join('; '),
    omitted > 0
      ? `(${omitted} additional QuickBooks error${omitted === 1 ? '' : 's'} omitted)`
      : '',
    details.length > 0 && hasQuickBooksStaleObjectError(fault)
      ? QUICKBOOKS_STALE_OBJECT_GUIDANCE
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}
