import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { ControlInput } from '#control-analysis/inventory'
import { canonical } from '#design-conformance/model'

export type Scalar = string | number | boolean | null
export type Expr =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'undefined' | 'absent' | 'unknown' }
  | { kind: 'ref'; ref: string }
  | { kind: 'member'; object: Expr; key: string }
  | { kind: 'lookup'; object: Expr; key: Expr }
  | { kind: 'choice'; choices: Expr[] }
  | { kind: 'template'; parts: Expr[] }
  | { kind: 'call'; ref: string; args: Expr[] }
  | { kind: 'join'; array: Expr; separator: string }
  | { kind: 'object'; entries: ({ key: string; value: Expr } | { spread: Expr })[] }
  | { kind: 'array'; items: Expr[] }
export const unknown: Expr = { kind: 'unknown' }
export const omitted: Expr = { kind: 'undefined' }
const key = (n: t.Node) => (t.isIdentifier(n) ? n.name : t.isStringLiteral(n) ? n.value : '')

/** const protects the binding, not its object. Reject writes and unmodelled escapes. */
export function immutable(binding: Binding, seen = new Set<Binding>()): boolean {
  if (!binding.constant || seen.has(binding)) return false
  const next = new Set(seen).add(binding)
  return binding.referencePaths.every((p) => {
    let q = p
    while (q.parentPath?.isMemberExpression() && q.parentPath.get('object') === q) q = q.parentPath
    const parent = q.parentPath
    if (!parent) return false
    if (parent.isObjectProperty()) {
      // A selected member used as a JSX style value is a scalar read. The
      // containing style object does not expose the palette object itself.
      const object = parent.parentPath
      const container = object?.parentPath
      const attribute = container?.parentPath
      if (
        q.isMemberExpression() &&
        object?.isObjectExpression() &&
        container?.isJSXExpressionContainer() &&
        attribute?.isJSXAttribute() &&
        t.isJSXIdentifier(attribute.node.name, { name: 'style' })
      )
        return true
      return false
    }
    if (parent.isAssignmentExpression() || parent.isReturnStatement() || parent.isArrayExpression())
      return false
    if (parent.isUpdateExpression() || parent.isUnaryExpression({ operator: 'delete' }))
      return false
    if (parent.isCallExpression() || parent.isNewExpression())
      return (
        parent.isCallExpression() &&
        parent.get('callee') === q &&
        q.isMemberExpression() &&
        q.get('object') === p &&
        !q.node.computed &&
        t.isIdentifier(q.node.property, { name: 'join' }) &&
        parent.node.arguments.length === 1 &&
        t.isStringLiteral(parent.node.arguments[0])
      )
    if (
      parent.isVariableDeclarator() &&
      parent.get('init') === q &&
      t.isIdentifier(parent.node.id)
    ) {
      const alias = parent.scope.getBinding(parent.node.id.name)
      return !!alias && immutable(alias, next)
    }
    return true
  })
}

/** Detached expressions only; no NodePaths/ASTs retained after parsing a module. */
export function expression(
  node: t.Node | undefined,
  p: NodePath,
  ref: (n: t.Node, p: NodePath) => string,
  depth = 0
): Expr {
  if (!node) return { kind: 'literal', value: true }
  if (depth > 20) return unknown
  const sub = (n: t.Node) => expression(n, p, ref, depth + 1)
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node))
    return sub(node.expression)
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
    return { kind: 'literal', value: node.value }
  if (t.isNullLiteral(node)) return { kind: 'literal', value: null }
  if (t.isIdentifier(node))
    return node.name === 'undefined' && !p.scope.getBinding('undefined')
      ? omitted
      : { kind: 'ref', ref: ref(node, p) }
  if (t.isUnaryExpression(node, { operator: 'void' }) && t.isNumericLiteral(node.argument))
    return omitted
  if (t.isConditionalExpression(node))
    return { kind: 'choice', choices: [sub(node.consequent), sub(node.alternate)] }
  if (t.isLogicalExpression(node))
    return { kind: 'choice', choices: [sub(node.left), sub(node.right)] }
  if (t.isTemplateLiteral(node))
    return {
      kind: 'template',
      parts: node.quasis.flatMap((q, i) => [
        { kind: 'literal', value: q.value.cooked ?? q.value.raw } as Expr,
        ...(node.expressions[i] ? [sub(node.expressions[i])] : []),
      ]),
    }
  if (
    t.isTaggedTemplateExpression(node) &&
    t.isMemberExpression(node.tag) &&
    !node.tag.computed &&
    t.isIdentifier(node.tag.object, { name: 'String' }) &&
    !p.scope.getBinding('String') &&
    t.isIdentifier(node.tag.property, { name: 'raw' })
  )
    return {
      kind: 'template',
      parts: node.quasi.quasis.flatMap((q, i) => [
        { kind: 'literal', value: q.value.raw } as Expr,
        ...(node.quasi.expressions[i] ? [sub(node.quasi.expressions[i])] : []),
      ]),
    }
  if (
    t.isBinaryExpression(node, { operator: '+' }) &&
    (t.isStringLiteral(node.left) || t.isStringLiteral(node.right))
  )
    return { kind: 'template', parts: [sub(node.left), sub(node.right)] }
  if (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.object) &&
    p.scope.getBinding(node.object.name)?.path.isImportNamespaceSpecifier()
  )
    return { kind: 'ref', ref: ref(node, p) }
  if (t.isMemberExpression(node) && (!node.computed || t.isStringLiteral(node.property)))
    return { kind: 'member', object: sub(node.object), key: key(node.property) }
  if (t.isMemberExpression(node) && node.computed)
    return { kind: 'lookup', object: sub(node.object), key: sub(node.property) }
  if (t.isObjectExpression(node))
    return {
      kind: 'object',
      entries: node.properties.map((a) =>
        t.isSpreadElement(a)
          ? { spread: sub(a.argument) }
          : t.isObjectProperty(a) && (!a.computed || t.isStringLiteral(a.key))
            ? { key: key(a.key), value: sub(a.value) }
            : { spread: unknown }
      ),
    }
  if (t.isArrayExpression(node))
    return { kind: 'array', items: node.elements.map((item) => (item ? sub(item) : unknown)) }
  if (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.property, { name: 'join' }) &&
    node.arguments.length === 1 &&
    t.isStringLiteral(node.arguments[0])
  )
    return { kind: 'join', array: sub(node.callee.object), separator: node.arguments[0].value }
  if (t.isCallExpression(node))
    return { kind: 'call', ref: ref(node.callee, p), args: node.arguments.map(sub) }
  return unknown
}

/** Summarize bounded returns only; never execute helpers or trust their return annotations. */
export function functionResult(
  fn: NodePath<t.Function>,
  ref: (n: t.Node, p: NodePath) => string
): Expr {
  if (fn.node.async || fn.node.generator) return unknown
  const result = (p: NodePath): Expr => {
    const e = expression(p.node, p, ref)
    const supported = (x: Expr): boolean =>
      x.kind === 'object' ||
      x.kind === 'undefined' ||
      x.kind === 'literal' ||
      x.kind === 'ref' ||
      x.kind === 'member' ||
      x.kind === 'lookup' ||
      x.kind === 'template' ||
      (x.kind === 'choice' && x.choices.every(supported))
    return supported(e) ? e : unknown
  }
  const body = fn.get('body') as NodePath
  if (!body.isBlockStatement()) return result(body)
  const returns: Expr[] = []
  let unsupported = false
  const visit = (p: NodePath, depth: number): boolean => {
    if (depth > 20 || returns.length > 64) {
      unsupported = true
      return true
    }
    if (p.isReturnStatement()) {
      returns.push(p.node.argument ? result(p.get('argument') as NodePath) : omitted)
      return false
    }
    if (p.isBlockStatement()) {
      let fallsThrough = true
      for (const statement of p.get('body')) {
        if (!fallsThrough) break
        fallsThrough = visit(statement, depth + 1)
      }
      return fallsThrough
    }
    if (p.isIfStatement()) {
      const yes = visit(p.get('consequent'), depth + 1)
      const no = p.node.alternate ? visit(p.get('alternate') as NodePath, depth + 1) : true
      return yes || no
    }
    if (
      p.isVariableDeclaration({ kind: 'const' }) &&
      p.node.declarations.every((d) => t.isIdentifier(d.id))
    )
      return true
    unsupported = true
    return true
  }
  if (visit(body, 0)) returns.push(omitted)
  return unsupported || !returns.length ? unknown : { kind: 'choice', choices: returns }
}

interface Result {
  values: Scalar[]
  undefined: boolean
  unknown: boolean
  sources: string[]
  classInputs?: boolean
}
const empty = (): Result => ({ values: [], undefined: false, unknown: false, sources: [] })
const union = (xs: Result[]): Result => ({
  values: [...new Map(xs.flatMap((x) => x.values).map((v) => [canonical(v), v])).values()].sort(
    (a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0)
  ),
  undefined: xs.some((x) => x.undefined),
  unknown: xs.some((x) => x.unknown),
  sources: [...new Set(xs.flatMap((x) => x.sources))].sort(),
  classInputs: xs.some((x) => x.classInputs),
})

export class StaticInputs {
  readonly values = new Map<string, Expr>()
  readonly functions = new Map<string, Expr>()
  readonly unsafe = new Set<string>()
  constructor(readonly resolve: (ref: string) => string[]) {}
  evaluate(e: Expr, seen = new Set<string>(), depth = 0): Result {
    if (depth > 20) return { ...empty(), unknown: true }
    const sub = (x: Expr) => this.evaluate(x, seen, depth + 1)
    switch (e.kind) {
      case 'literal':
        return { ...empty(), values: [e.value] }
      case 'absent':
      case 'undefined':
        return { ...empty(), undefined: true }
      case 'unknown':
        return { ...empty(), unknown: true }
      case 'ref': {
        if (seen.has(e.ref)) return { ...empty(), unknown: true }
        const next = new Set(seen).add(e.ref)
        const refs = this.values.has(e.ref) ? [e.ref] : this.resolve(e.ref)
        return union(
          refs.map((r) => {
            const value = this.evaluate(this.values.get(r) ?? unknown, next, depth + 1)
            return { ...value, sources: [...new Set([r, ...value.sources])].sort() }
          })
        )
      }
      case 'member':
        return sub(this.property(e.object, e.key, seen, depth + 1))
      case 'lookup':
        return sub(this.lookup(e.object, e.key, seen, depth + 1))
      case 'choice': {
        const r = e.choices.length > 64 ? { ...empty(), unknown: true } : union(e.choices.map(sub))
        return r.values.length > 64 ? { ...r, values: r.values.slice(0, 64), unknown: true } : r
      }
      case 'object':
      case 'array':
        return { ...empty(), unknown: true }
      case 'call': {
        // Recognize cn only by resolved EMCN implementation, never by a local name.
        const refs = this.resolve(e.ref)
        if (!refs.some((r) => /^packages\/emcn\/.*#cn@/.test(r)))
          return sub(this.callResult(e, seen))
        const parts = e.args.map(sub)
        if (parts.some((r) => r.unknown)) return { ...empty(), unknown: true }
        const result = this.product(
          parts.map((r) => ({
            ...r,
            values: [...r.values.map((v) => (v ? String(v) : '')), ...(r.undefined ? [''] : [])],
            undefined: false,
          })),
          ' '
        )
        return { ...result, classInputs: true }
      }
      case 'join': {
        const items = this.arrayItems(e.array, seen, depth + 1)
        if (!items) return { ...empty(), unknown: true }
        const parts = items.map(sub)
        if (
          parts.some(
            (part) =>
              part.unknown || part.undefined || part.values.some((v) => typeof v !== 'string')
          )
        )
          return { ...empty(), unknown: true }
        return this.product(parts, e.separator)
      }
      case 'template':
        return this.product(e.parts.map(sub), '')
    }
  }
  private arrayItems(e: Expr, seen: Set<string>, depth: number): Expr[] | undefined {
    if (depth > 20) return undefined
    if (e.kind === 'array') return e.items.length <= 64 ? e.items : undefined
    if (e.kind !== 'ref' || seen.has(e.ref) || this.unsafe.has(e.ref)) return undefined
    const refs = this.values.has(e.ref) ? [e.ref] : this.resolve(e.ref)
    if (refs.length !== 1 || this.unsafe.has(refs[0])) return undefined
    return this.arrayItems(this.values.get(refs[0]) ?? unknown, new Set(seen).add(e.ref), depth + 1)
  }
  private lookup(object: Expr, key: Expr, seen: Set<string>, depth: number): Expr {
    if (depth > 20) return unknown
    const selected = this.evaluate(key, seen, depth + 1)
    if (!selected.unknown && !selected.undefined && selected.values.length) {
      if (selected.values.some((value) => !['string', 'number'].includes(typeof value)))
        return unknown
      return {
        kind: 'choice',
        choices: selected.values.map((value) =>
          this.property(object, String(value), seen, depth + 1)
        ),
      }
    }
    const names = this.objectKeys(object, seen, depth + 1)
    if (names && !names.unknown && names.names.length && names.names.length <= 64)
      return {
        kind: 'choice',
        choices: [
          ...names.names.map((name) => this.property(object, name, seen, depth + 1)),
          unknown,
        ],
      }
    const items = this.arrayItems(object, seen, depth + 1)
    return items ? { kind: 'choice', choices: items } : unknown
  }
  private callResult(e: Extract<Expr, { kind: 'call' }>, seen: Set<string>): Expr {
    if (seen.has(e.ref)) return unknown
    const refs = this.functions.has(e.ref) ? [e.ref] : this.resolve(e.ref)
    return refs.length
      ? { kind: 'choice', choices: refs.map((r) => this.functions.get(r) ?? unknown) }
      : unknown
  }
  /** Whether a newly understood helper contributes to this style object. */
  functionDerived(e: Expr, seen = new Set<string>(), depth = 0): boolean {
    if (depth > 20) return false
    if (e.kind === 'call') return this.callResult(e, seen).kind !== 'unknown'
    if (e.kind === 'ref') {
      if (seen.has(e.ref)) return false
      const refs = this.values.has(e.ref) ? [e.ref] : this.resolve(e.ref)
      return refs.some((r) =>
        this.functionDerived(this.values.get(r) ?? unknown, new Set(seen).add(e.ref), depth + 1)
      )
    }
    if (e.kind === 'choice') return e.choices.some((x) => this.functionDerived(x, seen, depth + 1))
    if (e.kind === 'object')
      return e.entries.some((x) => 'spread' in x && this.functionDerived(x.spread, seen, depth + 1))
    return false
  }
  private product(parts: Result[], separator: string): Result {
    let strings = ['']
    for (const part of parts) {
      if (
        part.unknown ||
        part.undefined ||
        !part.values.length ||
        strings.length * part.values.length > 64
      )
        return { ...empty(), unknown: true }
      strings = strings.flatMap((a) =>
        part.values.map((b) => (a ? a + separator + String(b) : String(b)))
      )
    }
    return {
      ...empty(),
      values: [...new Set(strings)],
      sources: [...new Set(parts.flatMap((p) => p.sources))].sort(),
    }
  }
  property(e: Expr, name: string, seen = new Set<string>(), depth = 0): Expr {
    if (depth > 20) return unknown
    if (e.kind === 'call')
      return this.property(this.callResult(e, seen), name, new Set(seen).add(e.ref), depth + 1)
    if (e.kind === 'lookup')
      return this.property(this.lookup(e.object, e.key, seen, depth + 1), name, seen, depth + 1)
    if (e.kind === 'ref') {
      if (seen.has(e.ref)) return unknown
      const next = new Set(seen).add(e.ref)
      const refs = this.values.has(e.ref) ? [e.ref] : this.resolve(e.ref)
      if (this.unsafe.has(e.ref) || refs.some((r) => this.unsafe.has(r))) return unknown
      return {
        kind: 'choice',
        choices: refs.map((r) =>
          this.property(this.values.get(r) ?? unknown, name, next, depth + 1)
        ),
      }
    }
    if (e.kind === 'choice')
      return {
        kind: 'choice',
        choices: e.choices.map((x) => this.property(x, name, seen, depth + 1)),
      }
    if (e.kind === 'undefined' || (e.kind === 'literal' && e.value === null))
      return { kind: 'absent' }
    if (e.kind !== 'object') return unknown
    let out: Expr = { kind: 'absent' }
    for (const entry of e.entries) {
      if ('key' in entry) {
        if (entry.key === name) out = entry.value
      } else {
        const x = this.property(entry.spread, name, seen, depth + 1)
        // Absent properties in a spread do not overwrite preceding attributes.
        out = this.overlay(out, x)
      }
    }
    return out
  }
  private overlay(previous: Expr, next: Expr): Expr {
    if (next.kind === 'absent') return previous
    if (next.kind === 'choice')
      return { kind: 'choice', choices: next.choices.map((e) => this.overlay(previous, e)) }
    return next
  }
  private objectKeys(
    e: Expr,
    seen = new Set<string>(),
    depth = 0
  ): { names: string[]; unknown: boolean } | undefined {
    if (depth > 20) return { names: [], unknown: true }
    if (e.kind === 'call')
      return this.objectKeys(this.callResult(e, seen), new Set(seen).add(e.ref), depth + 1)
    if (e.kind === 'undefined' || e.kind === 'absent' || (e.kind === 'literal' && e.value === null))
      return { names: [], unknown: false }
    if (e.kind === 'ref') {
      if (seen.has(e.ref) || this.unsafe.has(e.ref)) return { names: [], unknown: true }
      const refs = this.values.has(e.ref) ? [e.ref] : this.resolve(e.ref)
      const choices = refs.map((r) =>
        this.objectKeys(this.values.get(r) ?? unknown, new Set(seen).add(e.ref), depth + 1)
      )
      if (choices.every((r) => !r)) return undefined
      return {
        names: [...new Set(choices.flatMap((r) => r?.names ?? []))].sort(),
        unknown: choices.some((r) => !r || r.unknown),
      }
    }
    if (e.kind === 'choice') {
      const choices = e.choices.map((x) => this.objectKeys(x, seen, depth + 1))
      if (choices.every((r) => !r)) return undefined
      return {
        names: [...new Set(choices.flatMap((r) => r?.names ?? []))].sort(),
        unknown: choices.some((r) => !r || r.unknown),
      }
    }
    if (e.kind !== 'object') return undefined
    const names = new Set<string>()
    let uncertain = false
    for (const entry of e.entries) {
      if ('key' in entry) names.add(entry.key)
      else {
        const keys = this.objectKeys(entry.spread, seen, depth + 1)
        if (!keys || keys.unknown) uncertain = true
        for (const key of keys?.names ?? []) names.add(key)
      }
    }
    return { names: [...names].sort().slice(0, 64), unknown: uncertain || names.size > 64 }
  }
  input(e: Expr, expressionText: string, depth = 0): ControlInput {
    if (depth > 20) return { expression: expressionText, unresolved: true }
    const keys = this.objectKeys(e)
    if (keys?.names.length) {
      const properties = Object.fromEntries(
        keys.names.map((name) => [name, this.input(this.property(e, name), name, depth + 1)])
      )
      return {
        expression: expressionText,
        properties,
        unresolved: keys.unknown || Object.values(properties).some((p) => p.unresolved),
      }
    }
    const r = this.evaluate(e)
    return {
      expression: expressionText,
      values: r.values,
      unresolved: r.unknown,
      ...(r.undefined ? { mayBeUndefined: true } : {}),
      ...(r.sources.length ? { sources: r.sources } : {}),
      ...(r.classInputs ? { composition: 'class-inputs-before-merge' as const } : {}),
    }
  }
}
