import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { type CentralRecipeModule, registry } from '#design-conformance/contracts'
import { type Atom, canonical } from '#design-conformance/model'

type Value = string | number | boolean | null | Value[]
type Bindings = Map<string, t.Node | Value>

/** Normalize explicitly registered style recipes without importing or executing their source. */
export function extractCentralRecipes(
  file: string,
  source: string,
  contracts: Record<string, CentralRecipeModule> = registry.centralRecipes ?? {}
): {
  definitions: Atom[]
  unchecked: string[]
  exports: Record<string, 'recipe'>
  unresolvedExports: string[]
  inputs: Record<string, string>
} {
  const out = {
    definitions: [] as Atom[],
    unchecked: [] as string[],
    exports: {} as Record<string, 'recipe'>,
    unresolvedExports: [] as string[],
    inputs: {} as Record<string, string>,
  }
  const contract = contracts[file]
  if (!contract) return out
  if (Buffer.byteLength(source) > registry.limits.sourceBytes) {
    out.unresolvedExports = Object.keys(contract.exports)
    out.unchecked.push('Central recipe source exceeds parser limit')
    return out
  }
  try {
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const bindings: Bindings = new Map()
    const exports = new Map<string, string>()
    const declaration = (node: t.Node) => {
      if (t.isVariableDeclaration(node))
        for (const d of node.declarations)
          if (t.isIdentifier(d.id))
            bindings.set(d.id.name, node.kind === 'const' && d.init ? d.init : node)
      if (t.isFunctionDeclaration(node) && node.id) bindings.set(node.id.name, node)
    }
    for (const statement of ast.program.body) {
      if (t.isImportDeclaration(statement) && statement.importKind !== 'type')
        for (const specifier of statement.specifiers)
          if (!t.isImportSpecifier(specifier) || specifier.importKind !== 'type')
            bindings.set(specifier.local.name, statement)
      if (t.isExportNamedDeclaration(statement)) {
        if (statement.declaration) {
          declaration(statement.declaration)
          const d = statement.declaration
          if (t.isVariableDeclaration(d))
            for (const v of d.declarations) {
              if (t.isIdentifier(v.id)) exports.set(v.id.name, v.id.name)
            }
          if (t.isFunctionDeclaration(d) && d.id) exports.set(d.id.name, d.id.name)
        }
        if (!statement.source)
          for (const s of statement.specifiers) {
            if (t.isExportSpecifier(s))
              exports.set(
                t.isIdentifier(s.exported) ? s.exported.name : s.exported.value,
                s.local.name
              )
          }
      } else declaration(statement)
    }
    for (const [name, authority] of Object.entries(contract.exports)) {
      const local = exports.get(name)
      if (!local) continue
      let steps = 0
      const active = new Set<t.Node>()
      let aliasDepth = 0
      const fail = (): never => {
        throw new Error('unsupported or cyclic recipe syntax')
      }
      const normalize = (node: t.Node | Value, scope: Bindings, depth = 0): Value => {
        if (++steps > 4096 || depth > registry.limits.resolutionDepth * 4) return fail()
        if (node === null || typeof node !== 'object' || Array.isArray(node)) return node
        if (active.has(node)) return fail()
        active.add(node)
        try {
          const n = (child: t.Node) => normalize(child, scope, depth + 1)
          if (
            t.isTSAsExpression(node) ||
            t.isTSSatisfiesExpression(node) ||
            t.isTSNonNullExpression(node) ||
            t.isTypeCastExpression(node)
          )
            return n(node.expression)
          if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
            return ['literal', node.value]
          if (t.isNullLiteral(node)) return ['literal', null]
          if (t.isIdentifier(node)) {
            if (scope.has(node.name)) {
              if (++aliasDepth > registry.limits.resolutionDepth) return fail()
              try {
                return normalize(scope.get(node.name)!, scope, depth + 1)
              } finally {
                aliasDepth--
              }
            }
            if (node.name === 'undefined') return ['undefined']
            return fail()
          }
          if (t.isBinaryExpression(node) || t.isLogicalExpression(node))
            return [node.operator, n(node.left), n(node.right)]
          if (t.isUnaryExpression(node) && ['!', '-', '+', '~', 'typeof'].includes(node.operator))
            return [node.operator, n(node.argument)]
          if (t.isConditionalExpression(node))
            return ['if', n(node.test), n(node.consequent), n(node.alternate)]
          if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node))
            return [
              node.optional ? 'optional-member' : 'member',
              n(node.object),
              node.computed
                ? n(node.property)
                : t.isIdentifier(node.property)
                  ? node.property.name
                  : fail(),
            ]
          if (t.isObjectExpression(node))
            return [
              'object',
              ...node.properties
                .map((p) => {
                  if (!t.isObjectProperty(p) || p.computed || !t.isExpression(p.value))
                    return fail()
                  return [
                    t.isIdentifier(p.key)
                      ? p.key.name
                      : t.isStringLiteral(p.key) || t.isNumericLiteral(p.key)
                        ? String(p.key.value)
                        : fail(),
                    n(p.value),
                  ]
                })
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
            ]
          if (t.isArrayExpression(node))
            return ['array', ...node.elements.map((e) => (e && t.isExpression(e) ? n(e) : fail()))]
          if (t.isCallExpression(node)) {
            if (
              t.isMemberExpression(node.callee) &&
              !node.callee.computed &&
              t.isIdentifier(node.callee.object, { name: 'Math' }) &&
              !scope.has('Math') &&
              t.isIdentifier(node.callee.property) &&
              ['min', 'max', 'round', 'floor', 'ceil', 'abs'].includes(node.callee.property.name)
            )
              return [
                `Math.${node.callee.property.name}`,
                ...node.arguments.map((a) => (t.isExpression(a) ? n(a) : fail())),
              ]
            return fail()
          }
          if (
            t.isFunctionDeclaration(node) ||
            t.isFunctionExpression(node) ||
            t.isArrowFunctionExpression(node)
          ) {
            if (node.async || node.generator) return fail()
            const inner = new Map(bindings)
            const defaults: Value[] = []
            node.params.forEach((p, i) => {
              const id = t.isAssignmentPattern(p) ? p.left : p
              if (!t.isIdentifier(id)) return fail()
              inner.set(id.name, ['parameter', i])
              defaults.push(
                t.isAssignmentPattern(p) ? normalize(p.right, inner, depth + 1) : ['no-default']
              )
            })
            const body = t.isBlockStatement(node.body)
              ? statements(node.body.body, inner, depth + 1)
              : normalize(node.body, inner, depth + 1)
            return ['function', defaults, body]
          }
          return fail()
        } finally {
          active.delete(node)
        }
      }
      const statements = (body: t.Statement[], scope: Bindings, depth: number): Value => {
        if (++steps > 4096 || depth > registry.limits.resolutionDepth * 4) return fail()
        if (!body.length) return ['undefined']
        const [first, ...rest] = body
        if (t.isEmptyStatement(first)) return statements(rest, scope, depth + 1)
        if (t.isReturnStatement(first))
          return first.argument ? normalize(first.argument, scope, depth + 1) : ['undefined']
        if (t.isVariableDeclaration(first) && first.kind === 'const') {
          const next = new Map(scope)
          for (const d of first.declarations) {
            if (!t.isIdentifier(d.id) || !d.init) return fail()
            next.set(d.id.name, normalize(d.init, next, depth + 1))
          }
          return statements(rest, next, depth + 1)
        }
        if (t.isIfStatement(first)) {
          const branch = (s: t.Statement | null | undefined) =>
            s
              ? statements(
                  [...(t.isBlockStatement(s) ? s.body : [s]), ...rest],
                  new Map(scope),
                  depth + 1
                )
              : statements(rest, new Map(scope), depth + 1)
          return [
            'if',
            normalize(first.test, scope, depth + 1),
            branch(first.consequent),
            branch(first.alternate),
          ]
        }
        return fail()
      }
      try {
        const node = bindings.get(local)
        if (!node || typeof node !== 'object' || Array.isArray(node))
          throw new Error('missing declaration')
        out.inputs[name] = source.slice(node.start ?? 0, node.end ?? 0)
        const value = canonical(normalize(node, bindings))
        out.definitions.push({
          kind: 'style',
          property: authority.property,
          value,
          context: `central-recipe:${name}`,
          reference: authority.source,
          line: node.loc?.start.line ?? 1,
          column: node.loc?.start.column ?? 0,
        })
        out.exports[name] = 'recipe'
      } catch {
        out.unresolvedExports.push(name)
        out.unchecked.push(
          `Unresolved registered central recipe ${name}: unsupported, cyclic, or over-limit syntax`
        )
      }
    }
  } catch {
    out.unresolvedExports = Object.keys(contract.exports)
    out.unchecked.push('Unable to parse registered central recipe module')
  }
  return out
}
