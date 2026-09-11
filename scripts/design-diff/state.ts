import type { Binding, NodePath } from '@babel/traverse'
import * as t from '@babel/types'

/** Recognize React's binding, including import aliases, without trusting a local hook name. */
function reactStateHook(callee: NodePath): boolean {
  if (callee.isIdentifier()) {
    const binding = callee.scope.getBinding(callee.node.name)?.path
    return !!(
      binding?.isImportSpecifier() &&
      t.isIdentifier(binding.node.imported, { name: 'useState' }) &&
      binding.parentPath.isImportDeclaration() &&
      binding.parentPath.node.source.value === 'react'
    )
  }
  if (
    callee.isMemberExpression() &&
    !callee.node.computed &&
    t.isIdentifier(callee.node.property, { name: 'useState' }) &&
    t.isIdentifier(callee.node.object)
  ) {
    const binding = callee.scope.getBinding(callee.node.object.name)?.path
    return !!(
      (binding?.isImportDefaultSpecifier() || binding?.isImportNamespaceSpecifier()) &&
      binding.parentPath.isImportDeclaration() &&
      binding.parentPath.node.source.value === 'react'
    )
  }
  return false
}

/** Follow only updates to a rendered state binding; unrelated handler statements stay separate. */
export function stateInputs(declaration: NodePath<t.VariableDeclarator>, name: string) {
  const pattern = declaration.node.id
  const initial = declaration.get('init') as NodePath
  if (
    !t.isArrayPattern(pattern) ||
    !t.isIdentifier(pattern.elements[0], { name }) ||
    !t.isIdentifier(pattern.elements[1]) ||
    !initial.isCallExpression() ||
    !reactStateHook(initial.get('callee') as NodePath)
  )
    return undefined
  const writes = new Set<NodePath<t.CallExpression>>()
  const escapes = new Set<NodePath>()
  const seen = new Set<Binding>()
  const visit = (binding: Binding | undefined) => {
    if (!binding || seen.has(binding)) return
    seen.add(binding)
    for (const reference of binding.referencePaths) {
      const parent = reference.parentPath
      if (parent?.isCallExpression() && parent.node.callee === reference.node) writes.add(parent)
      else if (
        parent?.isVariableDeclarator() &&
        parent.node.init === reference.node &&
        t.isIdentifier(parent.node.id) &&
        parent.scope.getBinding(parent.node.id.name)?.constant &&
        seen.size < 16
      )
        visit(parent.scope.getBinding(parent.node.id.name))
      else if (parent) escapes.add(parent)
    }
  }
  visit(declaration.scope.getBinding(pattern.elements[1].name))
  return {
    initial: (initial.get('arguments') as NodePath[])[0],
    writes: [...writes],
    escapes: [...escapes],
  }
}
