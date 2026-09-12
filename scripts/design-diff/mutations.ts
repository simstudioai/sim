import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'

/** Writes to a referenced collection remain relevant even when its binding is const. */
export function mutations(binding: Binding, selected?: string): NodePath[] {
  const result = new Set<NodePath>()
  for (const reference of binding.referencePaths) {
    const first = reference.parentPath
    if (selected && first?.isMemberExpression() && first.node.object === reference.node) {
      const key = first.node.property
      const name =
        !first.node.computed && t.isIdentifier(key)
          ? key.name
          : t.isStringLiteral(key)
            ? key.value
            : undefined
      const method =
        first.parentPath.isCallExpression() && first.parentPath.node.callee === first.node
      if (name !== undefined && name !== selected && !method) continue
    }
    let value = reference
    let member = value.parentPath
    while (member?.isMemberExpression() && member.node.object === value.node) {
      const parent = member.parentPath
      if (
        (parent.isAssignmentExpression() && parent.node.left === member.node) ||
        parent.isUpdateExpression() ||
        parent.isUnaryExpression({ operator: 'delete' })
      )
        result.add(parent)
      const property = member.node.property
      const name = t.isIdentifier(property)
        ? property.name
        : t.isStringLiteral(property)
          ? property.value
          : ''
      if (
        parent.isCallExpression() &&
        parent.node.callee === member.node &&
        /^(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear)$/.test(
          name
        )
      )
        result.add(parent)
      value = member
      member = value.parentPath
    }
  }
  return [...result]
}

/** Passing a scalar property cannot expose its containing literal record to mutation. */
function primitiveRecord(binding: Binding, seen = new Set<Binding>()): boolean {
  if (
    seen.has(binding) ||
    seen.size > 16 ||
    !binding.constant ||
    !binding.path.isVariableDeclarator()
  )
    return false
  seen.add(binding)
  let initial = binding.path.get('init') as NodePath
  while (
    initial.isTSAsExpression() ||
    initial.isTSSatisfiesExpression() ||
    initial.isTSNonNullExpression()
  )
    initial = initial.get('expression') as NodePath
  if (initial.isIdentifier()) {
    const alias = initial.scope.getBinding(initial.node.name)
    return !!alias && primitiveRecord(alias, seen)
  }
  return (
    initial.isObjectExpression() &&
    initial.node.properties.every(
      (property) =>
        t.isObjectProperty(property) &&
        !property.computed &&
        (t.isStringLiteral(property.value) ||
          t.isNumericLiteral(property.value) ||
          t.isBooleanLiteral(property.value) ||
          t.isNullLiteral(property.value))
    )
  )
}

/** Reject writes and escaping object references before relying on an initial literal collection. */
export function immutableCollection(binding: Binding, seen = new Set<Binding>()): boolean {
  if (seen.has(binding)) return false
  seen.add(binding)
  if (!binding.constant || mutations(binding).length) return false
  return binding.referencePaths.every((reference) => {
    let value = reference
    while (value.parentPath?.isMemberExpression() && value.parentPath.node.object === value.node)
      value = value.parentPath
    if (value === reference.parentPath && value.isMemberExpression() && primitiveRecord(binding))
      return true
    let parent = value.parentPath
    if (
      parent?.isVariableDeclarator() &&
      parent.node.init === value.node &&
      t.isIdentifier(parent.node.id)
    ) {
      const alias = parent.scope.getBinding(parent.node.id.name)
      return !!alias && immutableCollection(alias, new Set(seen))
    }
    while (
      parent?.isObjectProperty() ||
      parent?.isObjectExpression() ||
      parent?.isArrayExpression()
    ) {
      value = parent
      parent = value.parentPath
    }
    if (!parent?.isCallExpression()) return true
    if (parent.node.callee === value.node) return false
    if (value !== reference) return false
    const callee = parent.node.callee
    return (
      t.isMemberExpression(callee) &&
      !callee.computed &&
      t.isIdentifier(callee.object, { name: 'Object' }) &&
      !parent.scope.getBinding('Object') &&
      t.isIdentifier(callee.property) &&
      ['entries', 'keys', 'values'].includes(callee.property.name) &&
      parent.node.arguments.length === 1
    )
  })
}
