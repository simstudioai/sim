import * as t from '@babel/types'

/** Read literal class-map enablement without evaluating predicates or application code. */
export function classMapTruth(node: t.Node, depth = 0): boolean | undefined {
  if (depth >= 12) return undefined
  if (
    t.isTSAsExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    t.isTSNonNullExpression(node) ||
    t.isTypeCastExpression(node)
  )
    return classMapTruth(node.expression, depth + 1)
  if (t.isNullLiteral(node)) return false
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
    return Boolean(node.value)
  if (t.isBigIntLiteral(node)) return !/^(?:0+|0[xob]0+)$/i.test(node.value.replace(/_/g, ''))
  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return node.quasis.some((part) => (part.value.cooked ?? part.value.raw).length > 0)
  if (t.isUnaryExpression(node)) {
    if (node.operator === 'void') return false
    if (node.operator === '!') {
      const truth = classMapTruth(node.argument, depth + 1)
      return truth === undefined ? undefined : !truth
    }
    if (['+', '-'].includes(node.operator) && t.isNumericLiteral(node.argument))
      return node.argument.value !== 0
    if (node.operator === '-' && t.isBigIntLiteral(node.argument))
      return classMapTruth(node.argument, depth + 1)
  }
  return undefined
}
