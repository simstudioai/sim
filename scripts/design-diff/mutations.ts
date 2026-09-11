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
