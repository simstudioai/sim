import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5'
import postcss from 'postcss'
import { type Atom, hash, type Note, type Surface } from '#design-conformance/model'

export function presentationProperty(input: string): string | undefined {
  const property = input.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  return ['font-family', 'font-size', 'font-weight', 'color', 'fill', 'stroke'].includes(property)
    ? property
    : undefined
}
export const presentationValue = (property: string, value: string) =>
  property === 'font-size' && /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value
const htmlTextCache = new WeakMap<object, boolean>()
export function visibleHtmlText(node: DefaultTreeAdapterMap['node']): boolean {
  const hit = htmlTextCache.get(node)
  if (hit !== undefined) return hit
  const tag = 'tagName' in node ? node.tagName : ''
  const result =
    !['title', 'desc'].includes(tag) &&
    (['text', 'tspan'].includes(tag) ||
      ('childNodes' in node && node.childNodes.some(visibleHtmlText)))
  htmlTextCache.set(node, result)
  return result
}
export function htmlArtwork(el: DefaultTreeAdapterMap['element'], inSvg: boolean): boolean {
  return (
    ['img', 'video', 'audio', 'canvas', 'picture', 'source'].includes(el.tagName) ||
    (inSvg &&
      ((!['svg', 'g', 'text', 'tspan', 'foreignObject'].includes(el.tagName) && !!el.tagName) ||
        (el.tagName === 'g' && !visibleHtmlText(el))))
  )
}

const dynamic = '__SIM_UNCHECKED_HTML_'
interface Fragment {
  value: string
  offsets: number[]
}
const property = (p: NodePath): string =>
  p.isIdentifier() ? p.node.name : p.isStringLiteral() ? p.node.value : ''

/** Only explicit rendering sinks. No generic search of string contents or metadata. */
export function htmlSink(p: NodePath): NodePath | undefined {
  if (p.isJSXAttribute() && t.isJSXIdentifier(p.node.name, { name: 'dangerouslySetInnerHTML' })) {
    const value = p.get('value')
    if (!value.isJSXExpressionContainer()) return undefined
    let expression = value.get('expression') as NodePath
    if (expression.isIdentifier()) {
      const binding = expression.scope.getBinding(expression.node.name)
      if (binding?.constant && binding.path.isVariableDeclarator())
        expression = binding.path.get('init') as NodePath
    }
    if (expression.isObjectExpression()) {
      const entry = expression
        .get('properties')
        .find(
          (q) => q.isObjectProperty() && !q.node.computed && property(q.get('key')) === '__html'
        )
      if (entry?.isObjectProperty()) return entry.get('value')
    }
  }
  if (
    p.isObjectProperty() &&
    !p.node.computed &&
    ['defaultValue', 'value'].includes(property(p.get('key'))) &&
    p.parentPath.isObjectExpression()
  ) {
    const text = p.parentPath
      .get('properties')
      .some(
        (q) =>
          q.isObjectProperty() &&
          !q.node.computed &&
          property(q.get('key')) === 'type' &&
          q.get('value').isStringLiteral({ value: 'text' })
      )
    if (text) return p.get('value')
  }
  return undefined
}

/** Read syntax reachable through constants, local returns and map/join; never call anything. */
export function renderedHtml(
  input: NodePath,
  source: string,
  owner: string,
  conformance = false
): { surfaces: Surface[]; unchecked: Note[] } {
  const surfaces: Surface[] = []
  const unchecked: Note[] = []
  const fragments: Fragment[] = []
  let visited = 0
  let bytes = 0
  const note = (p: NodePath, reason: string) =>
    unchecked.push({ line: p.node.loc?.start.line ?? 1, context: 'rendered-html', reason })
  // Decode JS string escapes while mapping every decoded character back to its source offset.
  const decode = (raw: string, offset: number): Fragment => {
    let value = ''
    const offsets: number[] = []
    for (let i = 0; i < raw.length; i++) {
      const start = i
      let out = raw[i]
      if (out === '\\') {
        const c = raw[++i]
        const escapes: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          v: '\v',
          '0': '\0',
        }
        if (c === '\n') out = ''
        else if (c === '\r') {
          out = ''
          if (raw[i + 1] === '\n') i++
        } else if (c === 'x' || c === 'u') {
          const braced = c === 'u' && raw[i + 1] === '{'
          const begin = i + (braced ? 2 : 1)
          const end = braced ? raw.indexOf('}', begin) : begin + (c === 'x' ? 2 : 4)
          out = String.fromCodePoint(Number.parseInt(raw.slice(begin, end), 16))
          i = braced ? end : end - 1
        } else out = escapes[c] ?? c
      }
      value += out
      for (let j = 0; j < out.length; j++) offsets.push(offset + start)
    }
    return { value, offsets }
  }
  const concat = (a: Fragment, b: Fragment): Fragment => ({
    value: a.value + b.value,
    offsets: a.offsets.concat(b.offsets),
  })
  const fragment = (p: NodePath): Fragment | undefined => {
    if (p.isStringLiteral())
      return decode(
        source.slice((p.node.start ?? 0) + 1, (p.node.end ?? 1) - 1),
        (p.node.start ?? 0) + 1
      )
    if (p.isTemplateLiteral()) {
      let out: Fragment = { value: '', offsets: [] }
      for (const [i, q] of p.node.quasis.entries()) {
        out = concat(out, decode(q.value.raw, q.start ?? 0))
        if (i < p.node.expressions.length) {
          const expression = p.node.expressions[i]
          const marker = `${dynamic}${hash(source.slice(expression.start ?? 0, expression.end ?? 0))}__`
          out = concat(out, {
            value: marker,
            offsets: Array(marker.length).fill(p.node.expressions[i].start ?? 0),
          })
        }
      }
      return out
    }
    return undefined
  }
  const read = (p: NodePath, active = new Set<t.Node>(), depth = 0): void => {
    if (!p.node) return
    if (depth > 12 || active.has(p.node) || ++visited > 256 || bytes > 2 * 1024 * 1024) {
      note(p, 'Rendered HTML resolution limit or cycle')
      return
    }
    const next = new Set(active).add(p.node)
    const rec = (q: NodePath) => read(q, next, depth + 1)
    const f = fragment(p)
    if (f) {
      if (bytes + f.value.length > 2 * 1024 * 1024) {
        note(p, 'Rendered HTML resolution limit or cycle')
        return
      }
      bytes += f.value.length
      fragments.push(f)
      // Nested templates in text interpolation may themselves contain static HTML.
      if (p.isTemplateLiteral())
        for (const [i, e] of p.get('expressions').entries()) {
          const prefix = p.node.quasis
            .slice(0, i + 1)
            .map((q) => q.value.raw)
            .join('')
          if (
            prefix.lastIndexOf('<') <= prefix.lastIndexOf('>') &&
            (e.isTemplateLiteral() || e.isConditionalExpression())
          )
            rec(e)
        }
      return
    }
    if (p.isTSAsExpression() || p.isTSSatisfiesExpression() || p.isTSNonNullExpression()) {
      rec(p.get('expression') as NodePath)
      return
    }
    if (p.isIdentifier()) {
      const b = p.scope.getBinding(p.node.name)
      if (b?.constant && b.path.isVariableDeclarator()) {
        rec(b.path.get('init') as NodePath)
        return
      }
      if (b?.constant && b.path.isFunctionDeclaration()) {
        rec(b.path)
        return
      }
    }
    if (p.isFunction()) {
      const body = p.get('body') as NodePath
      if (!body.isBlockStatement()) {
        rec(body)
        return
      }
      body.traverse({
        Function(q) {
          q.skip()
        },
        ReturnStatement(q) {
          if (q.node.argument) rec(q.get('argument') as NodePath)
        },
      })
      return
    }
    if (p.isConditionalExpression()) {
      rec(p.get('consequent'))
      rec(p.get('alternate'))
      return
    }
    if (p.isLogicalExpression()) {
      rec(p.get('right'))
      if (p.node.operator !== '&&') rec(p.get('left'))
      return
    }
    if (p.isCallExpression()) {
      const callee = p.get('callee')
      if (callee.isIdentifier()) {
        const b = callee.scope.getBinding(callee.node.name)
        if (b?.constant && b.path.isFunctionDeclaration()) {
          rec(b.path)
          return
        }
        if (b?.constant && b.path.isVariableDeclarator()) {
          const init = b.path.get('init')
          if (init.isFunction()) {
            rec(init)
            return
          }
        }
      }
      if (callee.isMemberExpression() && !callee.node.computed) {
        const method = property(callee.get('property') as NodePath)
        const object = callee.get('object')
        if (
          method === 'join' &&
          p.get('arguments').length <= 1 &&
          (!p.node.arguments[0] || t.isStringLiteral(p.node.arguments[0]))
        ) {
          rec(object)
          return
        }
        if (method === 'map') {
          const callback = p.get('arguments')[0]
          if (callback?.isFunction()) {
            rec(callback)
            return
          }
        }
      }
    }
    note(p, 'Computed rendered HTML is unchecked')
  }
  read(input)
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1)
  const location = (offset: number) => {
    let lo = 0
    let hi = lineStarts.length
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 }
  }
  for (const f of fragments) {
    const visit = (node: DefaultTreeAdapterMap['node'], inSvg = false) => {
      const el = node as DefaultTreeAdapterMap['element']
      const svg = inSvg || el.tagName === 'svg'
      if (
        conformance
          ? htmlArtwork(el, svg)
          : ['svg', 'img', 'video', 'audio', 'canvas', 'picture', 'source'].includes(el.tagName)
      )
        return
      const loc = el.sourceCodeLocation
      if (loc && el.tagName) {
        const s: Surface = {
          kind: 'element',
          owner: `${owner}:rendered-html`,
          target: el.tagName,
          shared: false,
          ...location(f.offsets[loc.startOffset] ?? 0),
          atoms: [],
          references: [],
        }
        const add = (kind: Atom['kind'], property: string, value: string, offset: number) =>
          s.atoms.push({
            kind,
            property,
            value,
            context: 'html',
            ...location(f.offsets[offset] ?? 0),
          })
        for (const attr of el.attrs) {
          const property = conformance ? presentationProperty(attr.name) : undefined
          if (!['class', 'style'].includes(attr.name) && !property) continue
          if (property && svg && ['svg', 'g'].includes(el.tagName) && !visibleHtmlText(el)) continue
          const a = loc.attrs?.[attr.name]
          if (!a) continue
          // A complete static attribute is safe even when the element's text is computed.
          if (f.value.slice(a.startOffset, a.endOffset).includes(dynamic)) {
            unchecked.push({
              line: location(f.offsets[a.startOffset]).line,
              context: 'rendered-html',
              reason: `Dynamic rendered HTML ${attr.name} attribute is unchecked`,
            })
            s.unresolved ??= []
            s.unresolved.push({
              channel: attr.name === 'class' ? 'class' : 'style',
              property: '*',
              expression: f.value.slice(a.startOffset, a.endOffset),
              position: attr.name,
              line: s.line,
            })
            continue
          }
          if (attr.name === 'class')
            for (const c of attr.value.split(/\s+/).filter(Boolean))
              add('class', 'class', c, a.startOffset)
          if (property)
            add('style', property, presentationValue(property, attr.value), a.startOffset)
          if (attr.name === 'style') {
            try {
              postcss.parse(`x{${attr.value}}`).walkDecls((d) => {
                add('style', d.prop, d.value + (d.important ? ' !important' : ''), a.startOffset)
              })
            } catch {
              s.unresolved ??= []
              s.unresolved.push({
                channel: 'style',
                property: '*',
                expression: attr.value,
                position: 'invalid-style',
                line: s.line,
              })
              unchecked.push({
                line: s.line,
                context: 'rendered-html',
                reason: 'Invalid rendered HTML style attribute is unchecked',
              })
            }
          }
        }
        surfaces.push(s)
      }
      for (const c of 'childNodes' in node ? node.childNodes : []) visit(c, svg)
    }
    visit(parseFragment(f.value, { sourceCodeLocationInfo: true }))
  }
  return { surfaces, unchecked }
}
