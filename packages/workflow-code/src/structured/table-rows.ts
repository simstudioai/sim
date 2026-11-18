/**
 * Table rows (`table`): each `{ id, cells }` row's client-generated id is dropped on the way in and
 * restored on the way out, and the editor's blank starter row is dropped.
 */

import { isRecordLike, omit } from '@sim/utils/object'
import type { CanonContext } from '../canonicalize/context'
import { toValue } from '../canonicalize/values'
import type { MaterializeContext } from '../materialize/context'
import type { ParamSite } from '../materialize/params'
import type { Value } from '../model'
import { deepEqual, parseStoredList } from '../records'
import {
  compilePlain,
  encodePlain,
  liftPlain,
  noLockItems,
  printPlain,
  type StructuredCodec,
} from './codec'

/**
 * Table rows (normalize.ts `sanitizeTableRows`): a `{ id, cells }` row loses its
 * client-generated `id`, and a row whose cells are all blank (the editor's starter row) is
 * dropped. Rows of any other shape carry data and pass through verbatim.
 */
function liftTableRows(list: unknown[], context: CanonContext): Value {
  const rows: Value[] = []
  for (const row of list) {
    if (!isRecordLike(row) || !isRecordLike(row.cells) || Object.hasOwn(row, '$sim')) {
      rows.push(toValue(row, context))
      continue
    }
    const blank = Object.values(row.cells).every(
      (cell) => cell === '' || cell === null || cell === undefined
    )
    if (blank) continue
    rows.push(toValue(omit(row, ['id']), context))
  }
  return rows
}

/**
 * Puts table row ids back: canonicalize dropped each `{ id, cells }` row's id, so a row
 * takes the id of the first unused prev row with the same cells, else a new one.
 */
function restoreRowIds(list: unknown[], site: ParamSite, context: MaterializeContext) {
  const prevRows = (parseStoredList(site.prevRaw) ?? []).filter(
    (row): row is Record<string, unknown> & { id: string } =>
      isRecordLike(row) && typeof row.id === 'string' && isRecordLike(row.cells)
  )
  const used = new Set<string>()
  return list.map((row) => {
    if (!isRecordLike(row) || !isRecordLike(row.cells) || row.id !== undefined) return row
    const cells = row.cells
    const match = prevRows.find((prev) => !used.has(prev.id) && deepEqual(prev.cells, cells))
    const id = match?.id ?? context.hooks.newId()
    used.add(id)
    return { id, ...row }
  })
}

export const TABLE_ROWS_CODEC: StructuredCodec = {
  lift(decoded, { context }) {
    if (!Array.isArray(decoded)) return liftPlain()
    return { param: { kind: 'value', value: liftTableRows(decoded, context) } }
  },
  varNodes: false,
  compileLiteral: compilePlain,
  print: printPlain,
  encode(value, site, context) {
    const json = encodePlain(value, site, context)
    return Array.isArray(json) ? restoreRowIds(json, site, context) : json
  },
  lockItems: noLockItems,
}
