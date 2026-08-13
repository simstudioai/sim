import { createHash } from 'node:crypto'

/**
 * The one canonicalization every paginated surface stamps its cursors with.
 *
 * A cursor names a position in *one* sequence. Everything that reorders or
 * re-filters that sequence therefore has to travel with it, or replaying the
 * token against a re-filtered read silently answers from a sequence the caller
 * never asked for. `lib/table/rows/cursor.ts` and the v2 list codecs in
 * `app/api/v2/lib/response.ts` both bind through this module so there is one
 * fingerprint format rather than one per surface.
 *
 * What belongs in a binding is every param that changes *which rows, in which
 * order*. What must stay out is `limit`: it selects how much of the sequence to
 * return, not what the sequence is, so a caller is free to change page size
 * mid-walk. Response-shaping params (whether to inline trace spans, say) stay
 * out for the same reason.
 */

/**
 * Caller-facing message for a cursor replayed under different filters. Separate
 * from the sort-mismatch message on purpose: both mean "restart pagination",
 * but naming the half that actually changed is the difference between a caller
 * finding the bug in its own code and re-reading the sort docs.
 */
export const REFILTERED_CURSOR_MESSAGE =
  'cursor does not match the requested filters. Restart pagination without a cursor after changing a filter.'

/** A scalar a list filter can be expressed as, before canonicalization. */
export type CursorScopePart =
  | string
  | number
  | boolean
  | Date
  | readonly string[]
  | null
  | undefined

/**
 * Deterministic JSON: object keys sorted so two structurally equal values
 * serialize identically regardless of the key order they arrived in, and
 * `undefined` members dropped so an omitted param and an absent one agree.
 *
 * Array order is preserved — reordering an `in` list is treated as a different
 * filter, which only ever costs a restart.
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
