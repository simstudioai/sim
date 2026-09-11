import type traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

/** Normalize the equivalent Object.entries record-map idiom without executing its callback. */
export function normalizeRefactors(ast: t.File, visit: typeof traverse): void {
  visit(ast, {
    CallExpression(path) {
      const node = path.node
      if (
        !t.isMemberExpression(node.callee) ||
        node.callee.computed ||
        !t.isIdentifier(node.callee.property, { name: 'reduce' }) ||
        node.arguments.length !== 2
      )
        return
      const entries = node.callee.object
      if (
        !t.isCallExpression(entries) ||
        !t.isMemberExpression(entries.callee) ||
        entries.callee.computed ||
        !t.isIdentifier(entries.callee.object, { name: 'Object' }) ||
        !t.isIdentifier(entries.callee.property, { name: 'entries' }) ||
        entries.arguments.length !== 1 ||
        path.scope.getBinding('Object')
      )
        return
      const [callback, initial] = node.arguments
      if (
        !t.isArrowFunctionExpression(callback) ||
        callback.async ||
        callback.params.length !== 2 ||
        !t.isIdentifier(callback.params[0]) ||
        !t.isArrayPattern(callback.params[1]) ||
        callback.params[1].elements.length !== 2 ||
        !callback.params[1].elements.every(t.isIdentifier) ||
        !t.isObjectExpression(initial) ||
        initial.properties.length
      )
        return
      const body = callback.body
      if (!t.isObjectExpression(body) || body.properties.length !== 2) return
      const [spread, property] = body.properties
      const accumulator = callback.params[0].name
      const key = callback.params[1].elements[0] as t.Identifier
      if (
        !t.isSpreadElement(spread) ||
        !t.isIdentifier(spread.argument, { name: accumulator }) ||
        !t.isObjectProperty(property) ||
        !property.computed ||
        !t.isIdentifier(property.key, { name: key.name })
      )
        return
      let readsAccumulator = false
      t.traverseFast(property.value, (node) => {
        if (t.isIdentifier(node, { name: accumulator })) readsAccumulator = true
      })
      if (readsAccumulator || !t.isExpression(property.value)) return
      const map = t.callExpression(t.memberExpression(t.cloneNode(entries), t.identifier('map')), [
        t.arrowFunctionExpression(
          [t.cloneNode(callback.params[1])],
          t.arrayExpression([t.cloneNode(key), t.cloneNode(property.value)])
        ),
      ])
      const replacement = t.callExpression(
        t.memberExpression(t.identifier('Object'), t.identifier('fromEntries')),
        [map]
      )
      replacement.loc = node.loc
      path.replaceWith(replacement)
      path.skip()
    },
  })
}

/** Fold immutable local literal aliases consistently before resolution budgets are applied. */
export function normalizeLiteralAliases(ast: t.File, visit: typeof traverse): void {
  const cached = new WeakMap<t.Node, t.Expression | null>()
  const literal = (path: NodePath, seen = new Set<t.Node>()): t.Expression | null => {
    if (!path.node || seen.has(path.node) || seen.size > 64) return null
    if ((path.node.end ?? 0) - (path.node.start ?? 0) > 4096) return null
    if (cached.has(path.node)) return cached.get(path.node) ?? null
    seen.add(path.node)
    let value: t.Expression | null = null
    if (
      path.isStringLiteral() ||
      path.isNumericLiteral() ||
      path.isBooleanLiteral() ||
      path.isNullLiteral()
    )
      value = t.cloneNode(path.node)
    else if (
      path.isTSAsExpression() ||
      path.isTSSatisfiesExpression() ||
      path.isTSNonNullExpression()
    )
      value = literal(path.get('expression') as NodePath, seen)
    else if (path.isReferencedIdentifier()) {
      const binding = path.scope.getBinding(path.node.name)
      if (binding?.constant && binding.path.isVariableDeclarator())
        value = literal(binding.path.get('init') as NodePath, seen)
    } else if (path.isObjectExpression()) {
      const properties: t.ObjectProperty[] = []
      let valid = true
      for (const property of path.get('properties')) {
        if (!property.isObjectProperty() || property.node.computed) {
          valid = false
          break
        }
        const item = literal(property.get('value') as NodePath, new Set(seen))
        const key = property.node.key
        if (!item || !(t.isIdentifier(key) || t.isStringLiteral(key) || t.isNumericLiteral(key))) {
          valid = false
          break
        }
        properties.push(
          t.objectProperty(
            t.stringLiteral(t.isIdentifier(key) ? key.name : String(key.value)),
            item
          )
        )
      }
      if (valid) value = t.objectExpression(properties)
    } else if (path.isArrayExpression()) {
      const elements = path
        .get('elements')
        .map((element) => literal(element as NodePath, new Set(seen)))
      if (elements.every((item) => item !== null)) value = t.arrayExpression(elements)
    }
    cached.set(path.node, value)
    return value
  }
  visit(ast, {
    Expression(path) {
      if (path.parentPath.isExportSpecifier()) return
      if (!(path.isReferencedIdentifier() || path.isObjectExpression() || path.isArrayExpression()))
        return
      const value = literal(path)
      if (!value) return
      const replacement = t.cloneNode(value)
      replacement.loc = path.node.loc
      if (path.parentPath.isObjectProperty() && path.parentPath.node.shorthand)
        path.parentPath.node.shorthand = false
      path.replaceWith(replacement)
      path.skip()
    },
  })
}
