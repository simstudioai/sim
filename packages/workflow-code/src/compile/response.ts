import type { Node, ObjectProperty } from '@babel/types'
import type { CanonicalParam, SubBlockId, Value } from '../model'
import { setOwn } from '../records'
import { RESPONSE_BODY_KEYS } from '../sdk'
import { type CompileContext, rangeOf, unsupported } from './context'
import { didYouMean } from './hints'
import { compileJsonField, compileValue, objectEntries, type ValueSite } from './values'

/** A value that must compile to text (a string, template, reference or env var). */
function textValue(ctx: CompileContext, node: Node, site: ValueSite, what: string): string | null {
  const compiled = compileValue(ctx, node, site)
  if (!compiled) return null
  if (compiled.kind === 'value' && typeof compiled.value === 'string') return compiled.value
  unsupported(
    ctx,
    node,
    `${what} is text.`,
    `Write ${what} as a string, template or reference.`,
    site.decl.key
  )
  return null
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
