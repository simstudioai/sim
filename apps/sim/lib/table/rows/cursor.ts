/**
 * Opaque pagination cursor for the v2 table-query surface.
 *
 * The token is a base64url-encoded JSON payload that hides whether paging is
 * keyset- or offset-based, so callers (the v2 tools, the agent) only ever echo
 * an opaque `cursor` and never juggle `orderKey`/`id`/`offset` themselves.
 *
 * - Default order → keyset on `(order_key, id)` (`{ k, i }`), an index seek.
 * - Sorted views → whole-view offset (`{ o }`), because `(order_key, id)`
 *   keyset can't seek a data-column ordering.
 * - Keyset page whose last row lacks an `orderKey` (rows predating the backfill,
 *   or forked rows that inherited a NULL key) → compound (`{ k, i, o }`): seek to
 *   the last keyed anchor, then OFFSET past the unkeyed rows consumed after it.
 *   This only resolves correctly because the seek admits `order_key IS NULL`
 *   rows; a bare `(order_key, id) > (…)` excludes them and strands the tail.
 *
 * Every shape is stamped with the query it was produced under — see
 * {@link assertCursorQueryBinding}.
 */

import { canonicalJson, canonicalUnorderedArray, fingerprint } from '@/lib/api/cursor-binding'
import { TableQueryValidationError } from '@/lib/table/errors'
import type { Filter, Sort, TablePredicate, TableRow, TableRowsCursor } from '@/lib/table/types'

/**
 * Cursor payload version. Every encoded token carries `v`; decode rejects any
 * other value so a future shape change (new `v`) fails cleanly instead of being
 * misread against the current field set.
 *
 * Deliberately NOT bumped for the filter stamp. Adding `p` is additive: a token
 * minted before it still decodes, and an unfiltered read — where the stamp is
 * absent on both sides — resumes normally across the deploy. A pre-stamp token
 * replayed against a filtered query is the only one that fails, and it fails
 * with `CURSOR_FILTER_CONFLICT` and "Restart paging without the cursor", which
 * is both accurate and actionable. Bumping the version would trade that for a
 * generic unreadable-cursor 400 on EVERY in-flight token, including the
 * unfiltered ones that would otherwise have kept working.
 */
const CURSOR_VERSION = 1

type CursorBody = { k: string; i: string } | { o: number } | { k: string; i: string; o: number }
type QueryBinding = { s?: string; p?: string }
type CursorPayload = CursorBody & QueryBinding & { v: number }

/**
 * The query state a page was produced under. Every shape is bound to the
 * filters; only a shape carrying an offset is additionally bound to the sort.
 */
export interface CursorQueryScope {
  sort?: Sort | null
  /** v2 predicate tree, in the same storage form the query runs under. */
  predicate?: TablePredicate | null
  /** Legacy `$`-operator filter, for the surfaces that still send one. */
  filter?: Filter | null
}

/**
 * Canonical fingerprint of a sort for cursor binding. Entry order is the sort
 * priority (built from the ordered spec upstream), so stringifying entries is
 * deterministic for equal sorts and distinct for different ones.
 */
export function canonicalSortKey(sort: Sort | null | undefined): string | undefined {
  if (!sort) return undefined
  const entries = Object.entries(sort)
  return entries.length > 0 ? JSON.stringify(entries) : undefined
}

/**
 * Canonical form of a predicate node, with every set-valued position sorted.
 *
 * `canonicalJson` sorts object keys but preserves array order, which is right
 * for a sequence and wrong for a set. A predicate tree is sets all the way
 * down: `all`/`any` compile to `and(...)`/`or(...)`, and an `in`/`nin` operand
 * compiles to an OR fan-out / `IN (...)`. Member order changes none of those
 * row sets, so binding the caller's spelling refuses a cursor for a page that
 * is genuinely the next one.
 *
 * Non-set positions fall through to `canonicalJson` unchanged, so two
 * predicates that select different rows still fingerprint differently.
 */
function canonicalPredicateNode(node: unknown): string {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return canonicalJson(node)
  const record = node as Record<string, unknown>
  const setValuedOperand = record.op === 'in' || record.op === 'nin'
  const entries = Object.entries(record)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries
    .map(([key, entry]) => {
      if (Array.isArray(entry) && (key === 'all' || key === 'any')) {
        return `${JSON.stringify(key)}:${canonicalUnorderedArray(entry, canonicalPredicateNode)}`
      }
      if (Array.isArray(entry) && key === 'value' && setValuedOperand) {
        return `${JSON.stringify(key)}:${canonicalUnorderedArray(entry)}`
      }
      return `${JSON.stringify(key)}:${canonicalJson(entry)}`
    })
    .join(',')}}`
}

/**
 * Fingerprint of the filters a page was produced under, or `undefined` for an
 * unfiltered read. Canonicalized and hashed through `lib/api/cursor-binding`,
 * the same module the v2 list codecs bind through, so a filter stamp means the
 * same thing on every paginated surface.
 */
export function canonicalFilterKey(
  scope: Pick<CursorQueryScope, 'predicate' | 'filter'>
): string | undefined {
  const predicate = scope.predicate ?? undefined
  const filter = scope.filter && Object.keys(scope.filter).length > 0 ? scope.filter : undefined
  if (!predicate && !filter) return undefined
  return fingerprint(
    predicate ? `{"predicate":${canonicalPredicateNode(predicate)}}` : canonicalJson({ filter })
  )
}

/**
 * A cursor is only valid for the exact query shape it was minted under —
 * `lib/api/cursor-binding.ts` documents why. Here that means two distinct
 * refusals: a keyset or compound cursor encodes a position in the DEFAULT
 * `(order_key, id)` order and an offset cursor encodes a position in THAT sort,
 * so an ordering mismatch throws `CURSOR_SORT_CONFLICT`; a filter mismatch
 * throws `CURSOR_FILTER_CONFLICT` and applies to EVERY shape, since an absolute
 * `(order_key, id)` position is still incomplete under a wider filter.
 */
export function assertCursorQueryBinding(
  decoded: { after?: TableRowsCursor; offset?: number; sortKey?: string; filterKey?: string },
  scope: CursorQueryScope
): void {
  const requestedSort = canonicalSortKey(scope.sort)
  if (decoded.after && requestedSort !== undefined) {
    throw new TableQueryValidationError(
      'Cursor is not valid for a sorted query. Restart paging without the cursor.',
      'CURSOR_SORT_CONFLICT'
    )
  }
  if (
    decoded.after === undefined &&
    decoded.offset !== undefined &&
    decoded.sortKey !== requestedSort
  ) {
    throw new TableQueryValidationError(
      'Cursor was created under a different sort. Restart paging without the cursor.',
      'CURSOR_SORT_CONFLICT'
    )
  }
  if (decoded.filterKey !== canonicalFilterKey(scope)) {
    throw new TableQueryValidationError(
      'Cursor was created under a different filter. Restart paging without the cursor.',
      'CURSOR_FILTER_CONFLICT'
    )
  }
}

function invalidCursor(): never {
  throw new TableQueryValidationError('Invalid cursor', 'INVALID_CURSOR')
}

function toBase64Url(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64url')
}

function fromBase64Url(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8')
}

/**
 * Builds the cursor for the page *after* `lastRow`.
 *
 * Shape selection:
 * 1. `keysetValid` and the row carries an `orderKey` → `{ k, i }`.
 * 2. `keysetValid` with a known prior anchor (last row unkeyed) → `{ k, i, o }`.
 * 3. Otherwise → `{ o: nextOffset }` (whole-view offset).
 *
 * `keysetValid` must only be true when the `(order_key, id)` index order is
 * authoritative for the page: no custom sort AND fractional ordering enabled.
 * Passing false forces the offset shape, which is correct under any ordering.
 */
export function encodeCursor(args: {
  lastRow: Pick<TableRow, 'id' | 'orderKey'>
  keysetValid: boolean
  nextOffset: number
  seekBase?: { anchor: TableRowsCursor; offsetFromAnchor: number }
  /** The sort the page was produced under — stamps offset cursors so they can't be replayed against a different ordering. */
  sort?: Sort | null
  /** The predicate the page was produced under — stamps any offset so it can't be replayed against a different row set. */
  predicate?: TablePredicate | null
  /** The legacy filter the page was produced under, for surfaces that send one instead of a predicate. */
  filter?: Filter | null
}): string {
  let body: CursorBody
  if (args.keysetValid && args.lastRow.orderKey) {
    body = { k: args.lastRow.orderKey, i: args.lastRow.id }
  } else if (args.seekBase) {
    // An anchor is in effect (inbound seek or last keyed row) but a plain
    // keyset can't stand alone — resume by seeking the anchor then offsetting
    // past the rows consumed after it. Never valid under a custom sort, where
    // callers must not pass a seekBase.
    body = {
      k: args.seekBase.anchor.orderKey,
      i: args.seekBase.anchor.id,
      o: args.seekBase.offsetFromAnchor,
    }
  } else {
    body = { o: args.nextOffset }
  }
  const sortKey = canonicalSortKey(args.sort)
  const filterKey = canonicalFilterKey(args)
  const payload: CursorPayload = {
    ...body,
    // Only the pure-offset shape can exist under a custom sort; keyset and
    // compound shapes are default-order by construction and carry no binding.
    ...('k' in body || sortKey === undefined ? {} : { s: sortKey }),
    // Every offset — whole-view or offset-from-anchor — counts filtered rows, so
    // both the pure-offset and compound shapes carry the filter stamp.
    ...(filterKey !== undefined ? { p: filterKey } : {}),
    v: CURSOR_VERSION,
  }
  return toBase64Url(JSON.stringify(payload))
}

/** Decodes an opaque cursor into the `queryRows` paging inputs it stands for. */
export function decodeCursor(token: string): {
  after?: TableRowsCursor
  offset?: number
  /** Sort fingerprint an offset cursor was minted under; absent = default order. */
  sortKey?: string
  /** Filter fingerprint an offset cursor was minted under; absent = unfiltered. */
  filterKey?: string
} {
  let payload: unknown
  try {
    payload = JSON.parse(fromBase64Url(token))
  } catch {
    invalidCursor()
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    invalidCursor()
  }

  const record = payload as Record<string, unknown>
  if (record.v !== CURSOR_VERSION) invalidCursor()
  const hasKeyset = typeof record.k === 'string' && typeof record.i === 'string'
  const hasOffset = typeof record.o === 'number' && Number.isInteger(record.o) && record.o >= 0

  const filterBinding = typeof record.p === 'string' ? { filterKey: record.p } : {}

  if (hasKeyset && hasOffset) {
    return {
      after: { orderKey: record.k as string, id: record.i as string },
      offset: record.o as number,
      ...filterBinding,
    }
  }
  if (hasKeyset) {
    return { after: { orderKey: record.k as string, id: record.i as string }, ...filterBinding }
  }
  if (hasOffset) {
    return {
      offset: record.o as number,
      ...(typeof record.s === 'string' ? { sortKey: record.s } : {}),
      ...filterBinding,
    }
  }
  invalidCursor()
}
