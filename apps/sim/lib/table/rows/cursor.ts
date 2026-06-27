/**
 * Opaque pagination cursor for the v2 table-query surface.
 *
 * The token is a base64url-encoded JSON payload that hides whether paging is
 * keyset- or offset-based, so callers (the v2 tools, the agent) only ever echo
 * an opaque `cursor` and never juggle `orderKey`/`id`/`offset` themselves.
 *
 * - Default order → keyset on `(order_key, id)` (`{ k, i }`), an index seek.
 * - Sorted views / rows not yet order-key-backfilled → offset fallback (`{ o }`),
 *   because `(order_key, id)` keyset can't seek a data-column ordering.
 */

import type { Sort, TableRow, TableRowsCursor } from '@/lib/table/types'

type CursorPayload = { k: string; i: string } | { o: number }

function toBase64Url(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64url')
}

function fromBase64Url(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8')
}

/**
 * Builds the cursor for the page *after* `lastRow`. Uses keyset for the default
 * order when the row carries an `orderKey`; otherwise falls back to `nextOffset`
 * (the offset to resume at = current offset + rows returned).
 */
export function encodeCursor(args: {
  lastRow: Pick<TableRow, 'id' | 'orderKey'>
  sort?: Sort
  nextOffset: number
}): string {
  const isDefaultOrder = !args.sort || Object.keys(args.sort).length === 0
  const payload: CursorPayload =
    isDefaultOrder && args.lastRow.orderKey
      ? { k: args.lastRow.orderKey, i: args.lastRow.id }
      : { o: args.nextOffset }
  return toBase64Url(JSON.stringify(payload))
}

/** Decodes an opaque cursor into the `queryRows` paging inputs it stands for. */
export function decodeCursor(token: string): { after?: TableRowsCursor; offset?: number } {
  let payload: CursorPayload
  try {
    payload = JSON.parse(fromBase64Url(token))
  } catch {
    throw new Error('Invalid cursor')
  }

  if ('k' in payload && 'i' in payload) {
    return { after: { orderKey: String(payload.k), id: String(payload.i) } }
  }
  if ('o' in payload && typeof payload.o === 'number' && Number.isInteger(payload.o)) {
    return { offset: payload.o }
  }
  throw new Error('Invalid cursor')
}
