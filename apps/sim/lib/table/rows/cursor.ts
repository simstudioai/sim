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
import type { TableRow, TableRowsCursor } from '@/lib/table/types'

/**
 * Cursor payload version. Every encoded token carries `v`; decode rejects any
 * other value so a future shape change (new `v`) fails cleanly instead of being
 * misread against the current field set.
 */
const CURSOR_VERSION = 1

type CursorBody = { k: string; i: string } | { o: number } | { k: string; i: string; o: number }
type CursorPayload = CursorBody & { v: number }

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
  const payload: CursorPayload = { ...body, v: CURSOR_VERSION }
  return toBase64Url(JSON.stringify(payload))
}

/** Decodes an opaque cursor into the `queryRows` paging inputs it stands for. */
export function decodeCursor(token: string): { after?: TableRowsCursor; offset?: number } {
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
    return { offset: record.o as number }
  }
  invalidCursor()
}
