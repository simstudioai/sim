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
 * Lowercases `value` into the `[a-z0-9-]` charset: every run of other characters
 * becomes one hyphen, and leading and trailing hyphens are dropped.
 *
 * ASCII-only by design — the character class drops accented and non-Latin text
 * rather than transliterating it, so `'Café'` yields `'caf'` and a wholly
 * non-Latin name yields `''`. Callers that need a non-empty result supply their
 * own fallback, because what to fall back to is theirs to decide.
 *
 * Truncation is likewise the caller's: slicing a slug can leave a trailing
 * hyphen, and whether to strip it, and at what length, varies by the identifier
 * being built.
 *
 * @example
 * slugify('Acme Corp')       // 'acme-corp'
 * slugify('  !!Hello!!  ')   // 'hello'
 * slugify('***')             // ''
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
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

/**
 * Maps every Unicode whitespace character to a plain space, one-to-one.
 *
 * Agent-authored block names and values routinely carry non-breaking or narrow
 * spaces that render identically to " " but never equal a typed space, silently
 * hiding matches. The replacement is length-preserving (every `\s` character is
 * a single UTF-16 unit), so indexes into the folded string remain valid ranges
 * into the original.
 *
 * Lives here rather than beside the workflow search index because the Note card
 * on the canvas has to fold identically to find the same occurrences, and it
 * renders from `@sim/workflow-renderer` — a package, which cannot import from
 * `apps/*`. Two copies of this rule silently disagreeing is precisely the bug
 * that made a match count in the panel and highlight nowhere on the card.
 */
export function foldSearchWhitespace(value: string): string {
  return value.replace(/\s/g, ' ')
}

/**
 * Visits every occurrence of `query` in `text`, without overlaps.
 *
 * The single definition of what "an occurrence" means for search, shared by the
 * workflow search index and by the Note card that has to mark the same hits on
 * the canvas. They live in different packages and cannot see each other, so a
 * second copy of this loop is a silent disagreement waiting to happen: the
 * panel counts a match the card never paints, which is exactly the bug that
 * arrived when only the whitespace fold was shared and the scan was not.
 *
 * Whitespace is folded first (see {@link foldSearchWhitespace}) and the fold is
 * one-to-one, so both bounds index the caller's own unfolded string.
 */
export function forEachSearchOccurrence(
  text: string,
  query: string,
  visit: (start: number, end: number) => void,
  caseSensitive = false
): void {
  if (!query) return

  const normalize = (value: string) => {
    const folded = foldSearchWhitespace(value)
    return caseSensitive ? folded : folded.toLowerCase()
  }
  const haystack = normalize(text)
  const needle = normalize(query)
  const step = Math.max(needle.length, 1)

  let index = haystack.indexOf(needle)
  while (index !== -1) {
    visit(index, index + needle.length)
    index = haystack.indexOf(needle, index + step)
  }
}

/**
 * ASCII punctuation a backslash may escape in markdown, per CommonMark. A
 * backslash before anything else is a literal backslash.
 */
const MARKDOWN_ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')

/**
 * `text` with an index back into the string it came from.
 *
 * `starts` has one more entry than `text` has characters: `starts[i]` is where
 * projected character `i` begins in the source, and `starts[text.length]` is
 * the source length. A projected range `[s, e)` therefore maps to the source
 * range `[starts[s], starts[e])` — including any backslash the projection
 * consumed, so a caller rewriting that span never leaves one stranded.
 */
export interface SearchTextProjection {
  text: string
  starts: number[]
}

/**
 * Projects markdown onto the text it renders as, for MATCHING only.
 *
 * The rich-text editor's serializer backslash-escapes every markdown-significant
 * character in prose, so a note the reader sees as `SB_ACTION` is stored as
 * `SB\_ACTION`. Searching what is on screen has to see through that.
 *
 * Deliberately a total, structure-free function: it does not try to know which
 * spans are code. Undoing an escape that a code fence would have kept literal
 * only ever changes which text a search highlights — no caller writes this
 * back — whereas a rewriter making the same mistake would corrupt the file.
 * That asymmetry is why the escape is undone here rather than at serialization.
 */
export function projectEscapedMarkdownForSearch(value: string): SearchTextProjection {
  if (!value.includes('\\')) {
    return { text: value, starts: identityStarts(value.length) }
  }

  let text = ''
  const starts: number[] = []

  for (let index = 0; index < value.length; index += 1) {
    const isEscape = value[index] === '\\' && MARKDOWN_ESCAPABLE.has(value[index + 1] ?? '')
    starts.push(index)
    if (isEscape) index += 1
    text += value[index]
  }
  starts.push(value.length)

  return { text, starts }
}

function identityStarts(length: number): number[] {
  const starts: number[] = new Array(length + 1)
  for (let index = 0; index <= length; index += 1) starts[index] = index
  return starts
}
