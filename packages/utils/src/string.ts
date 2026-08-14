/**
 * `U+0000` is the one code point a Postgres `text`/`jsonb` value cannot carry:
 * the wire protocol terminates strings on it, so the driver throws before the
 * statement is planned, and the throw carries no SQLSTATE a route layer can
 * classify — it reaches the caller as a 500, on reads as readily as on writes.
 * Every boundary that admits caller-supplied text rejects it through
 * {@link containsNulCharacter}: the JSON request scan, the multipart field
 * scan, and the canonical folder-path decoder.
 *
 * Deliberately only NUL. `\n`, `\t`, and `\r` are ordinary content Postgres
 * stores verbatim, and a lone surrogate is substituted with `U+FFFD` by the
 * driver's encoder rather than throwing — a fidelity question, not an
 * availability one.
 */
const NUL_CHARACTER = '\u0000'

/** Reports whether `value` carries a `U+0000`. See {@link NUL_CHARACTER}. */
export function containsNulCharacter(value: string): boolean {
  return value.includes(NUL_CHARACTER)
}

/**
 * Truncates `str` if it exceeds `sliceLength` characters, appending `suffix`.
 * The total output length when truncated is `sliceLength + suffix.length`.
 * Defaults suffix to `'...'`.
 *
 * @example
 * truncate('hello world', 8)         // 'hello wo...' (11 chars)
 * truncate('hello world', 8, ' …')   // 'hello wo …'
 * truncate('hi', 10)                 // 'hi'
 */
export function truncate(str: string, sliceLength: number, suffix = '...'): string {
  return str.length > sliceLength ? str.slice(0, sliceLength) + suffix : str
}

/**
 * Strips a trailing `_vN` version suffix from `value`, yielding the base type.
 * Only the single trailing suffix is removed; leading occurrences are left intact.
 *
 * @example
 * stripVersionSuffix('notion_search_v2')  // 'notion_search'
 * stripVersionSuffix('x')                 // 'x'
 * stripVersionSuffix('a_v2_v3')           // 'a_v2'
 */
export function stripVersionSuffix(value: string): string {
  return value.replace(/_v\d+$/, '')
}

/**
 * Tests whether `value` ends with a `_vN` version suffix.
 * Only a trailing suffix counts; a leading or embedded `_vN` does not match.
 *
 * @example
 * isVersionedType('notion_search_v2')  // true
 * isVersionedType('plain')             // false
 * isVersionedType('a_version')         // false
 */
export function isVersionedType(value: string): boolean {
  return /_v\d+$/.test(value)
}

/**
 * Normalizes an email address for comparison and storage by trimming
 * surrounding whitespace and lowercasing.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * RFC 5322-shaped syntax gate for a full address. Format only — domain
 * reputation, MX/DNS, and membership policy are the caller's concern.
 */
const EMAIL_SYNTAX_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/**
 * Bare `@domain` pattern, for allowlists that grant access to a whole domain.
 * Single-label domains (`@intranet`) are allowed — self-hosted deployments use
 * them — but a lone `@` and malformed labels are not.
 */
const EMAIL_DOMAIN_SYNTAX_REGEX =
  /^@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/**
 * Format-only email syntax check, capped at the RFC 5321 length limit.
 *
 * @param allowDomains - also accept a bare `@domain` entry, for allowlists that
 * grant access to an entire domain rather than a single address.
 */
export function isValidEmailSyntax(email: string, allowDomains = false): boolean {
  if (email.length > 254) return false
  return EMAIL_SYNTAX_REGEX.test(email) || (allowDomains && EMAIL_DOMAIN_SYNTAX_REGEX.test(email))
}

/**
 * Matches UTF-16 code units that Postgres JSONB rejects: unpaired surrogate
 * halves (e.g. produced by `slice()` cutting an astral character like 𝐀 in
 * half) and the NUL character, which jsonb cannot store at all.
 */
const JSONB_UNSAFE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\u0000/g

/**
 * Replaces unpaired UTF-16 surrogates and NUL characters with U+FFFD (�) so
 * the string can be stored in a Postgres `jsonb` column. Well-formed
 * surrogate pairs (emoji, mathematical alphanumerics, etc.) pass through
 * untouched.
 */
export function sanitizeForJsonb(str: string): string {
  return str.replace(JSONB_UNSAFE, '\uFFFD')
}

/**
 * Recursively applies {@link sanitizeForJsonb} to every string (values AND
 * keys) reachable from `value`. Use on untrusted payloads immediately before
 * writing them to a `jsonb` column; returns the input unchanged (same
 * reference) when nothing needs rewriting.
 */
export function sanitizeValueForJsonb<T>(value: T): T {
  if (typeof value === 'string') {
    const clean = sanitizeForJsonb(value)
    return (clean === value ? value : clean) as T
  }
  if (Array.isArray(value)) {
    let changed = false
    const result = value.map((item) => {
      const clean = sanitizeValueForJsonb(item)
      if (clean !== item) changed = true
      return clean
    })
    return (changed ? result : value) as T
  }
  if (typeof value === 'object' && value !== null) {
    let changed = false
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const cleanKey = sanitizeForJsonb(key)
      const cleanItem = sanitizeValueForJsonb(item)
      if (cleanKey !== key || cleanItem !== item) changed = true
      result[cleanKey] = cleanItem
    }
    return (changed ? result : value) as T
  }
  return value
}

/**
 * Formats a list of names as quoted values with an overflow tail, listing at
 * most `maxListed` names.
 *
 * @example
 * formatQuotedNameList(['A', 'B'], 3)            // '"A", "B"'
 * formatQuotedNameList(['A', 'B', 'C', 'D'], 3)  // '"A", "B", "C" and 1 more'
 * formatQuotedNameList([], 3)                    // ''
 */
export function formatQuotedNameList(names: string[], maxListed: number): string {
  const listed = names
    .slice(0, maxListed)
    .map((name) => `"${name}"`)
    .join(', ')
  const overflow = names.length - maxListed
  return overflow > 0 ? `${listed} and ${overflow} more` : listed
}
