import { posix } from 'node:path'
import * as t from '@babel/types'
import { componentContract, registry } from '#design-conformance/contracts'
import { canonical, type Facts, type Note, type Surface } from '#design-conformance/model'

type Value = string | number | { ref: string } | { parts: Value[]; binary?: boolean }
export interface Route {
  target: string
  slot: string
}
export interface SourceSummary {
  unchecked?: string[]
  exports: Record<string, string>
  stars: string[]
  values: Record<string, Value>
  wrappers?: Record<string, string>
  directDelegates?: Record<string, string[]>
  delegates: Record<string, string[]>
  slots: Record<string, Record<string, Route[][]>>
}
export const modulePath = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, '')
export function importPath(file: string, source: string): string {
  return modulePath(
    source.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(file), source))
      : source.startsWith('@/') && file.startsWith('apps/sim/')
        ? `apps/sim/${source.slice(2)}`
        : source
  )
}
const key = (node: t.Node) =>
  t.isIdentifier(node) || t.isJSXIdentifier(node)
    ? node.name
    : t.isStringLiteral(node)
      ? node.value
      : ''
const unwrapped = (node: t.Node): t.Node =>
  t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTSNonNullExpression(node)
    ? unwrapped(node.expression)
    : node

/** Detached declarations only. No ASTs, executable values or application-wide graph. */
export function summarize(ast: t.File, file: string): SourceSummary {
  const result: SourceSummary = {
    exports: Object.create(null),
    stars: [],
    values: Object.create(null),
    delegates: Object.create(null),
    slots: Object.create(null),
  }
  const imports = new Map<string, string>()
  const note = (reason: string) => {
    result.unchecked ??= []
    if (!result.unchecked.includes(reason)) result.unchecked.push(reason)
  }
  const local = (name: string) => `${modulePath(file)}#${name}`
  for (const node of ast.program.body)
    if (t.isImportDeclaration(node)) {
      for (const spec of node.specifiers)
        imports.set(
          spec.local.name,
          `${importPath(file, node.source.value)}#${t.isImportSpecifier(spec) ? key(spec.imported) : t.isImportDefaultSpecifier(spec) ? 'default' : '*'}`
        )
    }
  const ref = (name: string) => {
    const [first, ...rest] = name.split('.')
    const source = imports.get(first) ?? local(first)
    return rest.length
      ? source.endsWith('#*')
        ? source.slice(0, -1) + rest.join('.')
        : `${source}.${rest.join('.')}`
      : source
  }
  const tag = (node: t.JSXElement['openingElement']['name']): string =>
    t.isJSXIdentifier(node)
      ? /^[a-z]/.test(node.name)
        ? node.name
        : ref(node.name)
      : t.isJSXMemberExpression(node)
        ? ref(`${jsxName(node.object)}.${key(node.property)}`)
        : ''
  function jsxName(node: t.JSXIdentifier | t.JSXMemberExpression): string {
    return t.isJSXIdentifier(node) ? node.name : `${jsxName(node.object)}.${key(node.property)}`
  }
  const value = (raw: t.Node, depth = 0): Value | undefined => {
    if (depth > 12) {
      note('Value summary resolution limit')
      return undefined
    }
    const node = unwrapped(raw)
    if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return node.value
    if (t.isIdentifier(node)) return { ref: ref(node.name) }
    if (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument))
      return -node.argument.value
    if (t.isTemplateLiteral(node)) {
      const parts: Value[] = []
      for (let i = 0; i < node.quasis.length; i++) {
        parts.push(node.quasis[i].value.cooked ?? node.quasis[i].value.raw)
        if (i < node.expressions.length) {
          const v = value(node.expressions[i], depth + 1)
          if (v === undefined) return undefined
          parts.push(v)
        }
      }
      return { parts }
    }
    if (
      t.isBinaryExpression(node, { operator: '+' }) &&
      !(t.isNumericLiteral(node.left) && t.isNumericLiteral(node.right))
    ) {
      const a = value(node.left, depth + 1)
      const b = value(node.right, depth + 1)
      if (a !== undefined && b !== undefined) return { parts: [a, b], binary: true }
    }
    return undefined
  }
  for (const st of ast.program.body) {
    const decl = t.isExportNamedDeclaration(st) ? st.declaration : st
    if (t.isVariableDeclaration(decl) && decl.kind === 'const')
      for (const d of decl.declarations)
        if (t.isIdentifier(d.id) && d.init) {
          const v = value(d.init)
          if (v !== undefined) result.values[d.id.name] = v
        }
    if (t.isExportNamedDeclaration(st)) {
      if (t.isVariableDeclaration(decl))
        for (const d of decl.declarations)
          if (t.isIdentifier(d.id)) result.exports[d.id.name] = local(d.id.name)
      if (t.isFunctionDeclaration(decl) && decl.id)
        result.exports[decl.id.name] = local(decl.id.name)
      for (const spec of st.specifiers)
        if (t.isExportSpecifier(spec))
          result.exports[key(spec.exported)] = st.source
            ? `${importPath(file, st.source.value)}#${key(spec.local)}`
            : ref(key(spec.local))
    }
    if (t.isExportDefaultDeclaration(st)) {
      const d = st.declaration
      if (t.isIdentifier(d)) result.exports.default = ref(d.name)
      if (t.isFunctionDeclaration(d)) result.exports.default = local(d.id?.name ?? 'default')
    }
    if (t.isExportAllDeclaration(st)) result.stars.push(importPath(file, st.source.value))
  }
  const seen = new Set<string>()
  const fn = (name: string, node: t.Function) => {
    const params = new Map<string, string>()
    const objects = new Set<string>()
    for (const param of node.params) {
      if (t.isIdentifier(param)) objects.add(param.name)
      if (t.isObjectPattern(param))
        for (const p of param.properties)
          if (t.isObjectProperty(p)) {
            const v = t.isAssignmentPattern(p.value) ? p.value.left : p.value
            if (t.isIdentifier(v)) params.set(v.name, key(p.key))
          }
    }
    const shadowed = new Set([...objects, ...params.keys()])
    if (t.isBlockStatement(node.body))
      for (const st of node.body.body)
        if (t.isVariableDeclaration(st))
          for (const d of st.declarations)
            if (t.isIdentifier(d.id) && imports.has(d.id.name)) shadowed.add(d.id.name)
    const scopedTag = (node: t.JSXElement['openingElement']['name']) => {
      const first = t.isJSXNamespacedName(node) ? '' : jsxName(node).split('.')[0]
      return shadowed.has(first) ? `unresolved:${local(name)}.${first}` : tag(node)
    }
    const slot = (n: t.Node) =>
      t.isIdentifier(n)
        ? params.get(n.name)
        : t.isMemberExpression(n) &&
            !n.computed &&
            t.isIdentifier(n.object) &&
            objects.has(n.object.name)
          ? key(n.property)
          : undefined
    if (t.isBlockStatement(node.body))
      for (const st of node.body.body)
        if (t.isVariableDeclaration(st, { kind: 'const' }))
          for (const d of st.declarations)
            if (t.isIdentifier(d.id) && d.init) {
              const prop = slot(d.init)
              if (prop) params.set(d.id.name, prop)
            }
    const returnSyntax = (n: t.Node, depth = 0): t.Node[] => {
      if (depth > 12) {
        note('Component return summary resolution limit')
        return []
      }
      if (t.isReturnStatement(n)) return n.argument ? [n.argument] : []
      if (t.isBlockStatement(n)) return n.body.flatMap((s) => returnSyntax(s, depth + 1))
      if (t.isIfStatement(n))
        return [
          ...returnSyntax(n.consequent, depth + 1),
          ...(n.alternate ? returnSyntax(n.alternate, depth + 1) : []),
        ]
      return []
    }
    const returns: t.Node[] = t.isBlockStatement(node.body) ? returnSyntax(node.body) : [node.body]
    if (
      !returns.some((r) => {
        let renders = Boolean(slot(unwrapped(r)))
        t.traverseFast(r, (n) => {
          if (t.isJSXElement(n) || t.isJSXFragment(n)) renders = true
        })
        return renders
      })
    )
      return
    if (seen.has(name)) {
      delete result.slots[name]
      delete result.delegates[name]
      if (result.directDelegates) delete result.directDelegates[name]
      note(`Ambiguous component declaration ${name}; extraction mapping is unchecked`)
      return
    }
    seen.add(name)
    const delegation = (raw: t.Node, depth = 0): void => {
      if (depth > 12) {
        note('Component delegation summary resolution limit')
        return
      }
      const returned = unwrapped(raw)
      if (t.isJSXElement(returned)) {
        const target = scopedTag(returned.openingElement.name)
        if (
          target.includes('#') &&
          !target.startsWith('unresolved:') &&
          !returned.openingElement.attributes.some(
            (a) => t.isJSXAttribute(a) && ['className', 'style'].includes(key(a.name))
          )
        ) {
          result.delegates[name] ??= []
          result.delegates[name].push(target)
          if (depth === 0) {
            const direct = (result.directDelegates ??= Object.create(null))
            direct[name] ??= []
            direct[name].push(target)
          }
        }
        for (const child of returned.children) delegation(child, depth + 1)
      } else if (t.isJSXFragment(returned))
        for (const child of returned.children) delegation(child, depth + 1)
      else if (t.isJSXExpressionContainer(returned)) delegation(returned.expression, depth + 1)
      else if (t.isConditionalExpression(returned)) {
        delegation(returned.consequent, depth + 1)
        delegation(returned.alternate, depth + 1)
      } else if (t.isLogicalExpression(returned)) {
        delegation(returned.right, depth + 1)
        if (returned.operator !== '&&') delegation(returned.left, depth + 1)
      }
    }
    for (const returned of returns) delegation(returned)
    const routes: Record<string, Route[][]> = Object.create(null)
    const walk = (raw: t.Node, ancestors: Route[], depth = 0): void => {
      if (depth > 12) {
        note('Component slot summary resolution limit')
        return
      }
      const n = unwrapped(raw)
      const prop = slot(n)
      if (prop) {
        routes[prop] ??= []
        routes[prop].push(ancestors)
        return
      }
      if (t.isJSXElement(n)) {
        const target = scopedTag(n.openingElement.name)
        for (const attr of n.openingElement.attributes)
          if (t.isJSXAttribute(attr) && t.isJSXExpressionContainer(attr.value))
            walk(attr.value.expression, [{ target, slot: key(attr.name) }, ...ancestors], depth + 1)
        for (const child of n.children)
          walk(child, [{ target, slot: 'children' }, ...ancestors], depth + 1)
      } else if (t.isJSXFragment(n)) for (const c of n.children) walk(c, ancestors, depth + 1)
      else if (t.isJSXExpressionContainer(n)) walk(n.expression, ancestors, depth + 1)
      else if (t.isConditionalExpression(n)) {
        walk(n.consequent, ancestors, depth + 1)
        walk(n.alternate, ancestors, depth + 1)
      } else if (t.isLogicalExpression(n)) {
        walk(n.right, ancestors, depth + 1)
        if (n.operator !== '&&') walk(n.left, ancestors, depth + 1)
      }
    }
    for (const r of returns) walk(r, [])
    result.slots[name] = routes
  }
  t.traverseFast(ast, (node) => {
    if (t.isFunctionDeclaration(node)) fn(node.id?.name ?? 'default', node)
    if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init))
    )
      fn(node.id.name, node.init)
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && t.isCallExpression(node.init)) {
      const callee = node.init.callee
      const target = t.isIdentifier(callee)
        ? ref(callee.name)
        : t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object)
          ? ref(`${callee.object.name}.${key(callee.property)}`)
          : ''
      const inner = node.init.arguments[0]
      if (
        ['react#memo', 'react#forwardRef'].includes(target) &&
        (t.isFunctionExpression(inner) || t.isArrowFunctionExpression(inner))
      ) {
        fn(node.id.name, inner)
        result.wrappers ??= Object.create(null)
        result.wrappers![node.id.name] = target
      }
    }
  })
  return result
}

const summarySizes = new WeakMap<SourceSummary, number>()
const metadataSizes = new WeakMap<Facts, number>()
export class SourceIndex {
  readonly notes: (Note & { file?: string })[] = []
  private readonly centralTargets = new Map<string, string>()
  private readonly modules = new Map<string, { file: string; facts: Facts }>()
  private readonly callers = new Map<string, { file: string; surface: Surface }[]>()
  private readonly ancestry = new Map<string, string[][]>()
  constructor(
    items: { file: string; facts: Facts }[],
    readonly limit = registry.limits.summaryBytes ?? 32 * 1024 * 1024,
    readonly budget = { bytes: 0 }
  ) {
    for (const item of new Map(items.map((item) => [modulePath(item.file), item])).values()) {
      if (!item.facts.syntax) continue
      for (const reason of item.facts.syntax.unchecked ?? [])
        this.notes.push({ file: item.file, line: 1, context: 'source-summary', reason })
      let bytes = summarySizes.get(item.facts.syntax)
      if (bytes === undefined) {
        bytes = Buffer.byteLength(canonical(item.facts.syntax))
        summarySizes.set(item.facts.syntax, bytes)
      }
      let extra = metadataSizes.get(item.facts)
      if (extra === undefined) {
        extra = Buffer.byteLength(
          canonical(
            (item.facts.surfaces ?? []).map((s) => [
              s.owner,
              s.componentRef,
              s.routes,
              s.requiredProps,
              s.providedProps,
              s.unknownProps,
            ])
          )
        )
        metadataSizes.set(item.facts, extra)
      }
      bytes += extra
      if (this.budget.bytes + bytes > limit) {
        this.notes.push({
          line: 1,
          context: item.file,
          reason: 'Per-PR source summary limit; cross-module resolution is unchecked',
        })
        continue
      }
      this.budget.bytes += bytes
      const facts: Facts = {
        syntax: item.facts.syntax,
        atoms: [],
        unchecked: [],
        surfaces: (item.facts.surfaces ?? []).map((s) => ({
          kind: s.kind,
          owner: s.owner,
          target: s.target,
          shared: s.shared,
          line: s.line,
          column: s.column,
          atoms: [],
          references: [],
          componentRef: s.componentRef,
          routes: s.routes,
          providedProps: s.providedProps,
          requiredProps: s.requiredProps,
          unknownProps: s.unknownProps,
        })),
      }
      this.modules.set(modulePath(item.file), { file: item.file, facts })
    }
    for (const name of Object.keys(registry.components)) {
      const ref = `@sim/emcn#${name}`
      const resolved = this.resolve(ref)
      if (resolved) this.centralTargets.set(`${modulePath(resolved.file)}#${resolved.name}`, ref)
    }
    for (const { file, facts } of this.modules.values())
      for (const surface of facts.surfaces ?? []) {
        if (!surface.componentRef) continue
        const target = this.resolve(surface.componentRef)
        if (!target) continue
        const id = `${modulePath(target.file)}#${target.name}`
        const bucket = this.callers.get(id) ?? []
        bucket.push({ file, surface })
        this.callers.set(id, bucket)
      }
  }
  release(): void {
    this.modules.clear()
    this.callers.clear()
    this.ancestry.clear()
    this.centralTargets.clear()
  }
  canonicalTarget(ref: string): string {
    if (!ref.includes('#')) return ref
    if (componentContract(ref)) return ref
    const resolved = this.resolve(ref)
    return resolved
      ? (this.centralTargets.get(`${modulePath(resolved.file)}#${resolved.name}`) ?? ref)
      : ref
  }
  forwarded(target: string, slot: string, seen = new Set<string>()): Route[] {
    target = this.canonicalTarget(target)
    const id = `${target}:${slot}`
    if (seen.has(id) || seen.size >= 12) return []
    if (componentContract(target)) return [{ target, slot }]
    const next = new Set(seen).add(id)
    const resolved = this.resolve(target)
    const paths = resolved?.facts.syntax?.slots[resolved.name]?.[slot] ?? []
    const relationship = registry.rendering?.[target]
    const declared =
      relationship && this.modules.has(modulePath(relationship.source))
        ? (relationship.forwarding?.[slot] ?? [])
        : []
    return [
      ...new Map(
        [...declared, ...paths.flatMap((p) => (p[0] ? [p[0]] : []))]
          .flatMap((r) => this.forwarded(r.target, r.slot, next))
          .map((r) => [canonical(r), r])
      ).values(),
    ]
  }
  private split(ref: string) {
    const at = ref.lastIndexOf('#')
    let path = ref.slice(0, at)
    const name = ref.slice(at + 1)
    if (path === '@sim/workflow-renderer') path = 'packages/workflow-renderer/src/index'
    if (path === '@sim/emcn') path = 'packages/emcn/src/index'
    const item = this.modules.get(path) ?? this.modules.get(`${path}/index`)
    return { item, name }
  }
  resolve(
    ref: string,
    seen = new Set<string>()
  ): { file: string; name: string; facts: Facts } | undefined {
    if (seen.has(ref) || seen.size >= 12) return undefined
    const next = new Set(seen).add(ref)
    const { item, name } = this.split(ref)
    if (!item?.facts.syntax) return undefined
    const target = item.facts.syntax.exports[name]
    if (target && target !== ref && target !== `${modulePath(item.file)}#${name}`)
      return this.resolve(target, next)
    const alias = item.facts.syntax.values[name]
    if (alias && typeof alias === 'object' && 'ref' in alias) return this.resolve(alias.ref, next)
    if (
      Object.hasOwn(item.facts.syntax.values, name) ||
      Object.hasOwn(item.facts.syntax.slots, name)
    )
      return { file: item.file, name, facts: item.facts }
    const candidates = item.facts.syntax.stars.flatMap((s) => {
      const r = this.resolve(`${s}#${name}`, next)
      return r ? [r] : []
    })
    return candidates.length === 1 ? candidates[0] : undefined
  }
  value(ref: string): string | undefined {
    const value = this.evaluated(ref)
    return value === undefined ? undefined : String(value)
  }
  private evaluated(ref: string, seen = new Set<string>()): string | number | undefined {
    if (seen.has(ref) || seen.size >= 12) return undefined
    const resolved = this.resolve(ref)
    const next = new Set(seen).add(ref)
    const expression = resolved?.facts.syntax?.values[resolved.name]
    const visit = (v: Value): string | number | undefined => {
      if (typeof v === 'string' || typeof v === 'number') return v
      if ('ref' in v) return this.evaluated(v.ref, next)
      const parts = v.parts.map(visit)
      if (v.binary && parts.every((p) => typeof p === 'number')) return undefined
      return parts.every((p) => p !== undefined) ? parts.join('') : undefined
    }
    return expression === undefined ? undefined : visit(expression)
  }
  private limited(paths: string[][], context: string): string[][] {
    if (paths.length <= 64) return paths
    if (
      !this.notes.some(
        (n) => n.context === context && n.reason.startsWith('Composition branch limit')
      )
    )
      this.notes.push({
        line: 1,
        context,
        reason: 'Composition branch limit; remaining render contexts are unchecked',
      })
    return paths.slice(0, 64)
  }
  private routePaths(route: Route, seen = new Set<string>()): string[][] {
    route = { ...route, target: this.canonicalTarget(route.target) }
    const id = `${route.target}:${route.slot}`
    if (seen.has(id) || seen.size >= 12) {
      if (!this.notes.some((n) => n.context === id))
        this.notes.push({
          line: 1,
          context: id,
          reason: 'Composition resolution limit or cycle; context is unchecked',
        })
      return [[route.target]]
    }
    const next = new Set(seen).add(id)
    const relationship = registry.rendering?.[route.target]
    const registered = relationship?.slots?.[route.slot]
    if (registered && this.modules.has(modulePath(relationship.source))) return [registered]
    if (componentContract(route.target)) return [[route.target]]
    const resolved = this.resolve(route.target)
    const paths = resolved?.facts.syntax?.slots[resolved.name]?.[route.slot]
    if (!paths?.length) return [[route.target]]
    return this.limited(
      paths.flatMap((p) => this.expandRoutes(p, next)),
      id
    )
  }
  private expandRoutes(routes: Route[], seen = new Set<string>()): string[][] {
    let result: string[][] = [[]]
    for (const route of routes) {
      const paths = this.routePaths(route, seen)
      result = this.limited(
        result.flatMap((before) => paths.map((after) => [...before, ...after])),
        route.target
      )
    }
    return result
  }
  contexts(surface: Surface, file: string, seen = new Set<string>()): string[][] {
    const direct = this.expandRoutes(surface.routes ?? [])
    const ref = `${modulePath(file)}#${surface.owner}`
    if (seen.has(ref) || seen.size >= 12) return direct
    const contextKey = `${ref}:${(surface.requiredProps ?? []).join(',')}`
    let inherited = this.ancestry.get(contextKey)
    if (!inherited) {
      const next = new Set(seen).add(ref)
      inherited = (this.callers.get(ref) ?? [])
        .filter(
          (call) =>
            call.surface.unknownProps ||
            (surface.requiredProps ?? []).every((prop) =>
              call.surface.providedProps?.includes(prop)
            )
        )
        .flatMap((call) => this.contexts(call.surface, call.file, next))
      if (!inherited.length) inherited = [[]]
      inherited = this.limited(inherited, ref)
      if (seen.size === 0) {
        const bytes = Buffer.byteLength(canonical(inherited)) + contextKey.length * 2 + 64
        if (this.budget.bytes + bytes <= this.limit) {
          this.budget.bytes += bytes
          this.ancestry.set(contextKey, inherited)
        } else {
          if (!this.notes.some((n) => n.context === contextKey))
            this.notes.push({
              file,
              line: surface.line,
              context: contextKey,
              reason: 'Per-PR source summary limit; additional inherited contexts are unchecked',
            })
          return direct
        }
      }
    }
    return this.limited(
      direct.flatMap((a) => inherited.map((b) => [...a, ...b])),
      ref
    )
  }
  chain(surface: Surface, file: string, seen = new Set<string>()): string[] {
    const ref = `${modulePath(file)}#${surface.owner}`
    if (seen.has(ref) || seen.size >= 12) return []
    const next = new Set(seen).add(ref)
    return [
      ...new Set([
        ref,
        ...(surface.routes ?? []).map((r) => r.target),
        ...(this.callers.get(ref) ?? []).flatMap((c) => this.chain(c.surface, c.file, next)),
      ]),
    ].slice(0, 64)
  }
  /** Git pairs the files; a unique React wrapper pairs the exported source owners. */
  renamedOwner(
    before: SourceIndex,
    oldFile: string,
    newFile: string,
    owner: string
  ): string | undefined {
    const oldSyntax = before.modules.get(modulePath(oldFile))?.facts.syntax
    const newSyntax = this.modules.get(modulePath(newFile))?.facts.syntax
    const wrapper = newSyntax?.wrappers?.[owner]
    if (!wrapper || !oldSyntax || !newSyntax) return undefined
    const exported = (syntax: SourceSummary, file: string, name: string) =>
      Object.values(syntax.exports).includes(`${modulePath(file)}#${name}`)
    const oldOwners = Object.entries(oldSyntax.wrappers ?? {}).filter(
      ([name, value]) => value === wrapper && exported(oldSyntax, oldFile, name)
    )
    const newOwners = Object.entries(newSyntax.wrappers ?? {}).filter(
      ([name, value]) => value === wrapper && exported(newSyntax, newFile, name)
    )
    return oldOwners.length === 1 && newOwners.length === 1 && newOwners[0][0] === owner
      ? oldOwners[0][0]
      : undefined
  }
  extraction(
    before: SourceIndex,
    file: string,
    owner: string,
    mode: 'nested' | 'direct' = 'nested'
  ): { file: string; owner: string; copies: number } | undefined {
    const original = before.modules.get(modulePath(file))
    if (!original?.facts.syntax?.slots[owner]) return undefined
    const updated = this.modules.get(modulePath(file))
    const declarations = mode === 'direct' ? 'directDelegates' : 'delegates'
    const candidates = [
      ...new Set(
        (updated?.facts.syntax?.[declarations]?.[owner] ?? []).filter(
          (d) => !(original.facts.syntax?.[declarations]?.[owner] ?? []).includes(d)
        )
      ),
    ]
    if (mode === 'direct' && candidates.length !== 1) return undefined
    const targets = candidates.flatMap((candidate) => {
      const target = this.resolve(candidate)
      if (!target || (target.file === file && target.name === owner)) return []
      const prior = before.modules.get(modulePath(target.file))
      return prior?.facts.syntax?.slots[target.name] ? [] : [target]
    })
    if (targets.length !== 1) return undefined
    const target = targets[0]
    const copies =
      mode === 'direct'
        ? (this.callers.get(`${modulePath(target.file)}#${target.name}`) ?? []).length
        : 1
    return { file: target.file, owner: target.name, copies }
  }
}
