import { parse } from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'

/** Prove a JSON-only serializer with an HTML-safe '<' escape; never execute it. */
function jsonTransport(node: t.Node, p: NodePath): boolean {
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee)) return false
  const binding = p.scope.getBinding(node.callee.name)
  if (!binding?.constant || !binding.path.isFunctionDeclaration()) return false
  const fn = binding.path.node
  if (
    fn.async ||
    fn.generator ||
    fn.params.length !== 1 ||
    !t.isIdentifier(fn.params[0]) ||
    fn.body.body.length !== 1 ||
    !t.isReturnStatement(fn.body.body[0])
  )
    return false
  let value = fn.body.body[0].argument
  let escaped = false
  while (
    t.isCallExpression(value) &&
    t.isMemberExpression(value.callee) &&
    !value.callee.computed &&
    t.isIdentifier(value.callee.property, { name: 'replace' })
  ) {
    const [pattern, replacement] = value.arguments
    if (!t.isRegExpLiteral(pattern) || pattern.flags !== 'g' || !t.isStringLiteral(replacement))
      return false
    if (pattern.pattern === '<' && replacement.value === '\\u003c') escaped = true
    else if (
      !['\\u2028', '\\u2029'].includes(pattern.pattern) ||
      replacement.value !== pattern.pattern
    )
      return false
    value = value.callee.object
  }
  return (
    escaped &&
    t.isCallExpression(value) &&
    t.isMemberExpression(value.callee) &&
    t.isIdentifier(value.callee.object, { name: 'JSON' }) &&
    !binding.path.scope.getBinding('JSON') &&
    t.isIdentifier(value.callee.property, { name: 'stringify' }) &&
    value.arguments.length === 1 &&
    t.isIdentifier(value.arguments[0], { name: fn.params[0].name })
  )
}

export function nonUiScript(sink: NodePath): boolean {
  const opening = sink.findParent((p) => p.isJSXOpeningElement())
  if (!opening?.isJSXOpeningElement() || !t.isJSXIdentifier(opening.node.name, { name: 'script' }))
    return false
  const value = sink.node
  let script: string
  if (t.isTemplateLiteral(value)) {
    if (value.expressions.length !== 1 || !jsonTransport(value.expressions[0], sink)) return false
    script = `${value.quasis[0].value.cooked ?? ''}0${value.quasis[1].value.cooked ?? ''}`
  } else if (t.isStringLiteral(value)) script = value.value
  else return false
  try {
    const ast = parse(script)
    if (ast.program.body.length !== 1) return false
    const statement = ast.program.body[0]
    if (
      !t.isExpressionStatement(statement) ||
      !t.isAssignmentExpression(statement.expression, { operator: '=' })
    )
      return false
    const { left, right } = statement.expression
    if (
      !t.isMemberExpression(left) ||
      !t.isIdentifier(left.object, { name: 'window' }) ||
      !(left.computed ? t.isStringLiteral(left.property) : t.isIdentifier(left.property))
    )
      return false
    const data = (n: t.Node): boolean =>
      t.isStringLiteral(n) ||
      t.isNumericLiteral(n) ||
      t.isBooleanLiteral(n) ||
      t.isNullLiteral(n) ||
      (t.isArrayExpression(n) && n.elements.every((e) => !!e && data(e))) ||
      (t.isObjectExpression(n) &&
        n.properties.every((e) => t.isObjectProperty(e) && !e.computed && data(e.value)))
    return data(right)
  } catch {
    return false
  }
}
