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
 * Any shape carrying an offset is stamped with the query state that offset
 * counts positions within — the sort AND the filters — and refuses to resume
 * under a different one. See {@link assertCursorQueryBinding}.
 */

import { createHash } from 'node:crypto'
import { TableQueryValidationError } from '@/lib/table/errors'
import type { Filter, Sort, TablePredicate, TableRow, TableRowsCursor } from '@/lib/table/types'

/**
 * Cursor payload version. Every encoded token carries `v`; decode rejects any
 * other value so a future shape change (new `v`) fails cleanly instead of being
 * misread against the current field set.
 */
const CURSOR_VERSION = 1

type CursorBody = { k: string; i: string } | { o: number } | { k: string; i: string; o: number }
type QueryBinding = { s?: string; p?: string }
type CursorPayload = CursorBody & QueryBinding & { v: number }

/**
 * The filters an offset counts positions within. A cursor carrying an offset is
 * bound to both this and the sort; a pure keyset cursor is bound to neither,
 * because `(order_key, id)` names an absolute position that stays correct under
 * any membership change.
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
 * Deterministic JSON for a filter tree: object keys sorted so two structurally
 * equal filters serialize identically regardless of the key order the caller's
 * JSON happened to arrive in. Array order is preserved — reordering an `in` list
 * is treated as a different filter, which only ever costs a restart.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

/**
 * Fingerprint of the filters a page was produced under, or `undefined` for an
 * unfiltered read. Hashed rather than embedded: a predicate tree can be up to
 * the request-body ceiling, and the cursor has to stay a short opaque token.
 * SHA-256 over the canonical form, so a caller cannot cheaply construct a second
 * predicate that replays another sequence's offsets.
 */
export function canonicalFilterKey(
  scope: Pick<CursorQueryScope, 'predicate' | 'filter'>
): string | undefined {
  const predicate = scope.predicate ?? undefined
  const filter = scope.filter && Object.keys(scope.filter).length > 0 ? scope.filter : undefined
  if (!predicate && !filter) return undefined
  const canonical = canonicalJson(predicate ? { predicate } : { filter })
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 22)
}

/**
 * A cursor is only valid for the exact query shape it was minted under:
 * keyset/compound cursors encode a position in the DEFAULT `(order_key, id)`
 * order, and an offset cursor from a sorted view encodes a position in THAT
 * sort. Replaying either against a different ordering silently pages the wrong
 * sequence — rows skipped or duplicated with no error. Throws
 * `CURSOR_SORT_CONFLICT` so callers restart paging without the cursor.
 *
 * Any offset — the whole-view one and the compound cursor's offset-from-anchor
 * alike — counts rows in the FILTERED sequence, so it is bound to the filters as
 * well. Replaying an offset under a different predicate lands at that ordinal of
 * a sequence the caller never asked for: a narrower filter silently returns an
 * empty page the caller reads as "no more matches". That mismatch throws
 * `CURSOR_FILTER_CONFLICT`. A pure keyset cursor carries no offset and is left
 * unbound — `(order_key, id)` is an absolute position, correct under any filter.
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
  if (decoded.offset !== undefined && decoded.filterKey !== canonicalFilterKey(scope)) {
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
    ...('o' in body && filterKey !== undefined ? { p: filterKey } : {}),
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
    return { after: { orderKey: record.k as string, id: record.i as string } }
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
