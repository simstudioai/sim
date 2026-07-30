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
 */

import { TableQueryValidationError } from '@/lib/table/errors'
import type { Sort, TableRow, TableRowsCursor } from '@/lib/table/types'

/**
 * Cursor payload version. Every encoded token carries `v`; decode rejects any
 * other value so a future shape change (new `v`) fails cleanly instead of being
 * misread against the current field set.
 */
const CURSOR_VERSION = 1

type CursorBody = { k: string; i: string } | { o: number } | { k: string; i: string; o: number }
type SortBinding = { s?: string }
type CursorPayload = CursorBody & SortBinding & { v: number }

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
 * A cursor is only valid for the exact query shape it was minted under:
 * keyset/compound cursors encode a position in the DEFAULT `(order_key, id)`
 * order, and an offset cursor from a sorted view encodes a position in THAT
 * sort. Replaying either against a different ordering silently pages the wrong
 * sequence — rows skipped or duplicated with no error. Throws
 * `CURSOR_SORT_CONFLICT` so callers restart paging without the cursor.
 */
export function assertCursorSortBinding(
  decoded: { after?: TableRowsCursor; offset?: number; sortKey?: string },
  sort: Sort | null | undefined
): void {
  const requested = canonicalSortKey(sort)
  if (decoded.after && requested !== undefined) {
    throw new TableQueryValidationError(
      'Cursor is not valid for a sorted query. Restart paging without the cursor.',
      'CURSOR_SORT_CONFLICT'
    )
  }
  if (
    decoded.after === undefined &&
    decoded.offset !== undefined &&
    decoded.sortKey !== requested
  ) {
    throw new TableQueryValidationError(
      'Cursor was created under a different sort. Restart paging without the cursor.',
      'CURSOR_SORT_CONFLICT'
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
  const payload: CursorPayload = {
    ...body,
    // Only the pure-offset shape can exist under a custom sort; keyset and
    // compound shapes are default-order by construction and carry no binding.
    ...('k' in body || sortKey === undefined ? {} : { s: sortKey }),
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

  if (hasKeyset && hasOffset) {
    return {
      after: { orderKey: record.k as string, id: record.i as string },
      offset: record.o as number,
    }
  }
  if (hasKeyset) {
    return { after: { orderKey: record.k as string, id: record.i as string } }
  }
  if (hasOffset) {
    return {
      offset: record.o as number,
      ...(typeof record.s === 'string' ? { sortKey: record.s } : {}),
    }
  }
  invalidCursor()
}
