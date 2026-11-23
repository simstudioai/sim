/**
 * The response block's `response(name, { body, status?, headers? })` form, both directions: which
 * stored params the printer may write in it, and how the compiler stores each of its keys. Writing
 * `body` selects the form; without it the params are the block's own (`dataMode`, `data`, ...).
 */

import type { Node, ObjectProperty } from '@babel/types'
import { isRecordLike } from '@sim/utils/object'
import { RESPONSE_BLOCK_TYPE } from '@sim/workflow-types/workflow'
import { type CompileContext, rangeOf, unsupported } from '../compile/context'
import { didYouMean } from '../compile/hints'
import { compileJsonField, compileValue, objectEntries, type ValueSite } from '../compile/values'
import type { CanonicalBlock, CanonicalParam, SubBlockId, Value } from '../model'
import { getOwn, setOwn } from '../records'
import { RESPONSE_BODY_KEYS } from '../sdk'
import { holdsSecret } from '../secrets'

/** The stored params the form carries: the editor's JSON mode and its three fields. */
const FORM_PARAMS: ReadonlySet<string> = new Set(['dataMode', 'data', 'status', 'headers'])

/** A `status` the form prints as a number literal: a canonical positive integer. */
const NUMERIC_STATUS = /^[1-9][0-9]{0,14}$/

/** The stored values a response block prints in the form with. */
export interface ResponseForm {
  data: string
  status?: { text: string; numeric: boolean }
  headers?: Array<{ name: string; value: string }>
}

/**
 * The form a response block prints as, or `null` to keep its own params: a block in the editor's
 * JSON mode whose printed params (`paramKeys`, with nothing under `meta.extra`) the form carries
 * exactly, with distinct header names in `{ cells: { Key, Value } }` rows. The form writes its
 * fields' values as they are, so a block holding a detected credential in any of them keeps its
 * own params, where that param prints as `stored()`.
 */
export function readResponseForm(
  block: CanonicalBlock,
  paramKeys: readonly string[],
  hasExtra: boolean
): ResponseForm | null {
  if (hasExtra || paramKeys.some((key) => !FORM_PARAMS.has(key))) return null
  const value = (id: string): Value | undefined => {
    const param = getOwn(block.params, id)
    return param?.kind === 'value' ? param.value : undefined
  }
  const data = value('data')
  const status = value('status')
  const headers = value('headers')
  if (value('dataMode') !== 'json' || typeof data !== 'string') return null
  if ([data, status, headers].some((field) => field !== undefined && holdsSecret(undefined, field)))
    return null
  if (status !== undefined && typeof status !== 'string') return null
  const rows = headers === undefined ? [] : headers
  if (!Array.isArray(rows)) return null
  const names = new Set<string>()
  const pairs: Array<{ name: string; value: string }> = []
  for (const row of rows) {
    const cells = isRecordLike(row) && Object.keys(row).join() === 'cells' ? row.cells : null
    if (!isRecordLike(cells) || Object.keys(cells).sort().join() !== 'Key,Value') return null
    const { Key, Value: text } = cells
    if (typeof Key !== 'string' || typeof text !== 'string' || names.has(Key)) return null
    names.add(Key)
    pairs.push({ name: Key, value: text })
  }
  return {
    data,
    ...(status !== undefined && { status: { text: status, numeric: NUMERIC_STATUS.test(status) } }),
    ...(headers !== undefined && { headers: pairs }),
  }
}

/** Whether a call's params select the form: a response builder written with `body`. */
export function usesResponseForm(type: string, keys: readonly string[]): boolean {
  return type === RESPONSE_BLOCK_TYPE && keys.includes('body')
}

/** A value that must compile to text (a string, template, reference or env var). */
function textValue(ctx: CompileContext, node: Node, site: ValueSite, what: string): string | null {
  const compiled = compileValue(ctx, node, site)
  if (!compiled) return null
  if (compiled.kind === 'value' && typeof compiled.value === 'string') return compiled.value
  return unsupported(
    ctx,
    node,
    `${what} is text.`,
    `Write ${what} as a string, template or reference.`,
    site.decl.key
  )
}

/**
 * One key of the body form, stored the way the editor's JSON mode stores it: `body` in `data`
 * (an object or array literal as JSON text, `json-fields.ts`; text as written), `status` as text,
 * `headers` as the header table's `{ cells: { Key, Value } }` rows. The caller sets `dataMode`.
 */
export function compileResponseParam(
  ctx: CompileContext,
  site: ValueSite,
  params: Record<SubBlockId, CanonicalParam>,
  key: string,
  property: ObjectProperty
): void {
  const node = property.value
  switch (key) {
    case 'body': {
      if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') {
        compileJsonField(ctx, node, site, params, 'data')
        return
      }
      const text = textValue(ctx, node, site, 'body')
      if (text !== null) setOwn(params, 'data', { kind: 'value', value: text })
      return
    }
    case 'status': {
      const text =
        node.type === 'NumericLiteral' ? String(node.value) : textValue(ctx, node, site, 'status')
      if (text !== null) setOwn(params, 'status', { kind: 'value', value: text })
      return
    }
    case 'headers': {
      if (node.type !== 'ObjectExpression') {
        unsupported(
          ctx,
          node,
          'headers is an object literal.',
          "Write headers: { 'X-Id': id }.",
          site.decl.key
        )
        return
      }
      const rows: Value[] = []
      for (const [name, header] of objectEntries(ctx, node)) {
        const text = textValue(ctx, header.value, site, 'A header value')
        if (text === null) return
        rows.push({ cells: { Key: name, Value: text } })
      }
      setOwn(params, 'headers', { kind: 'value', value: rows })
      return
    }
    default: {
      const hint = didYouMean(key, RESPONSE_BODY_KEYS)
      ctx.reporter.report(
        'E_UNKNOWN_PARAM',
        `The body form of response takes ${RESPONSE_BODY_KEYS.join(', ')}; ${key} is not one.`,
        rangeOf(ctx, property),
        {
          hint: hint ?? 'Write the block params (dataMode, data, ...) without body instead.',
          blockKey: site.decl.key,
          param: key,
        }
      )
    }
  }
}
