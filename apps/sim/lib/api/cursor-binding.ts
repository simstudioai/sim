import { createHash } from 'node:crypto'

/**
 * Caller-facing message for a cursor replayed under different filters. Separate
 * from the sort-mismatch message on purpose: both mean "restart pagination",
 * but naming the half that actually changed is the difference between a caller
 * finding the bug in its own code and re-reading the sort docs.
 */
export const REFILTERED_CURSOR_MESSAGE =
  'cursor does not match the requested filters. Restart pagination without a cursor after changing a filter.'

/**
 * Caller-facing message for a token that cannot be decoded at all.
 *
 * Distinct from {@link REFILTERED_CURSOR_MESSAGE} and from
 * `INVALID_CURSOR_MESSAGE` for the same reason those two are distinct from each
 * other: an undecodable token says nothing about which param changed, and the
 * lists that raise it do not all have a sort to name. `GET /audit-logs`
 * declares neither `sortBy` nor `sortOrder` and its query schema is `.strict()`,
 * so sending a caller to adjust them answers one 400 with advice that earns a
 * second.
 */
export const UNREADABLE_CURSOR_MESSAGE =
  'cursor is not a valid pagination cursor. Restart pagination without a cursor.'

/** A scalar a list filter can be expressed as, before canonicalization. */
type CursorScopePart = string | number | boolean | Date | readonly string[] | null | undefined

/**
 * Canonical form of a filter the query treats as an unordered SET.
 *
 * A comma-separated list and a JSON object both have a spelling the caller
 * chose and a meaning the query acts on: `workflowIds=A,B` and `B,A` select the
 * same runs, and two `tagFilters` objects differing only in key order match the
 * same documents. Fingerprinting the raw spelling binds the cursor to the
 * spelling, so a caller who reorders an equivalent filter mid-walk gets a 400
 * for a page that is genuinely the next one.
 *
 * Members are de-duplicated as well as sorted: the filters compile to
 * `inArray`, which is set membership, so `A,A,B` selects exactly what `A,B` does
 * and must not bind to a different page.
 *
 * Derived from {@link parseUnorderedList} rather than parsing again, so the
 * members this fingerprints are exactly the members the query filters on. A
 * route that split the raw value itself would give `A,B` and `A, B` one
 * fingerprint and two different result sets.
 */
export function unorderedScopePart(raw: string | undefined): string | undefined {
  const members = parseUnorderedList(raw)
  return members && members.length > 0 ? members.join(',') : undefined
}

/**
 * The members of a comma-separated filter, trimmed, de-duplicated, and sorted.
 *
 * The one parse for both halves of a bound list filter: pass the array to the
 * query and {@link unorderedScopePart} to the cursor scope. Callers must not
 * re-split the raw value for one half — that is what lets the two drift.
 */
export function parseUnorderedList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  return [
    ...new Set(
      raw
        .split(',')
        .map((member) => member.trim())
        .filter((member) => member.length > 0)
    ),
  ].sort()
}

/**
 * Canonical form of an AND-conjoined filter set.
 *
 * Takes the value the query acts on, never the caller's raw text. Two spellings
 * that parse to one filter — an omitted field and its schema default, a
 * different key order — must fingerprint alike, and only the parsed value knows
 * that. Pass the output of the contract's own parser.
 *
 * {@link canonicalJson} preserves array order, which is right for a sequence and
 * wrong for a set: clauses compiled into `and(...)` select the same rows in any
 * order. Members are canonicalized, then de-duplicated and sorted, so `A AND A`
 * binds like `A` and clause order stops mattering.
 */
export function unorderedScopeOf(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return canonicalJson(value)
  return `[${[...new Set(value.map(canonicalJson))].sort().join(',')}]`
}

/**
 * Canonical form of a timestamp filter: the instant, not the caller's spelling.
 *
 * A window bound selects rows by the instant it names, and one instant has many
 * valid ISO 8601 spellings — `…00Z` and `…00.000Z` differ only in sub-second
 * precision, and both pass `z.string().datetime()`. Binding the text refuses a
 * cursor for the same window written a different way.
 *
 * An unparseable value binds by its spelling; that request fails validation.
 */
export function instantScopePart(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString()
}

/**
 * Deterministic JSON: object keys sorted so two structurally equal values
 * serialize identically regardless of the key order they arrived in, and
 * `undefined` members dropped so an omitted param and an absent one agree.
 *
 * Array order is preserved, because an array is a sequence in the general case.
 * A filter whose array is really a set must canonicalize it first — see
 * {@link parseUnorderedList} and {@link unorderedScopeOf} — or equivalent
 * queries fingerprint differently and a valid cursor is refused.
 */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

/**
 * Fingerprint of a canonical form, short enough to sit inside an opaque token.
 *
 * Hashed rather than embedded because the bound state can be large — a table
 * predicate runs to the request-body ceiling, and a v2 `search` term to 200
 * characters — while the cursor has to stay a token a caller can put in a query
 * string. SHA-256 also means a caller cannot cheaply construct a second filter
 * that collides with another sequence's stamp.
 */
export function fingerprint(canonical: string): string {
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 22)
}

/**
 * The fingerprint of a list's sequence-affecting params, or `undefined` when
 * the caller supplied none of them.
 *
 * A cursor names a position in *one* sequence, so everything that reorders or
 * re-filters that sequence has to travel with it — otherwise replaying the token
 * against a re-filtered read silently answers from a sequence the caller never
 * asked for. Pass every param that changes *which rows, in which order*. Keep
 * `limit` out: it selects how much of the sequence to return, not what the
 * sequence is, so a caller may change page size mid-walk. Response-shaping
 * params (whether to inline trace spans, say) stay out for the same reason.
 *
 * `undefined` is a real state rather than an empty hash: an unstamped cursor is
 * an unfiltered one, so it stays short, and replaying it under a filter still
 * mismatches (`undefined !== <hash>`). Params whose value is `undefined` are
 * dropped, so omitting a filter and never having sent it are the same scope.
 */
export function cursorScopeKey(parts: Record<string, CursorScopePart>): string | undefined {
  const present = Object.entries(parts).filter(([, value]) => value !== undefined)
  if (present.length === 0) return undefined
  return fingerprint(canonicalJson(Object.fromEntries(present)))
}
