import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { fingerprint, parseSyntax, propertyName, traverse } from '#design-diff/ast'

/** Project literal data objects; spreads, accessors, mutation and escaping aliases stay broad. */
export function objectFields(
  source: string,
  file: string
): Map<string, { fields: Map<string, string>; options: string }> {
  const result = new Map<string, { fields: Map<string, string>; options: string }>()
  const project = (
    node: t.Node | null | undefined,
    prefix: string[],
    fields: Map<string, string>
  ): boolean => {
    if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node))
      return project(node.expression, prefix, fields)
    if (!t.isObjectExpression(node)) {
      fields.set(JSON.stringify(prefix), fingerprint(node))
      return true
    }
    if (!node.properties.length) fields.set(JSON.stringify(prefix), fingerprint(node))
    const keys = new Set<string>()
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed) return false
      const key = propertyName(property.key)
      if (keys.has(key)) return false
      keys.add(key)
      if (!project(property.value, [...prefix, propertyName(property.key)], fields)) return false
    }
    return true
  }
  traverse(parseSyntax(source, file), {
    Program(p) {
      for (const [name, binding] of Object.entries(p.scope.bindings)) {
        if (!binding.path.isVariableDeclarator() || binding.kind !== 'const' || !binding.constant)
          continue
        let init = binding.path.node.init
        while (t.isTSAsExpression(init) || t.isTSSatisfiesExpression(init)) init = init.expression
        if (!t.isObjectExpression(init)) continue
        const safe = binding.referencePaths.every((reference) => {
          if (reference.isExportDeclaration() || reference.parentPath?.isExportSpecifier())
            return true
          let member: NodePath = reference
          while (member.parentPath?.isMemberExpression() && member.key === 'object')
            member = member.parentPath
          if (member === reference) return false
          const parent = member.parentPath
          return (
            !(parent?.isAssignmentExpression() && member.key === 'left') &&
            !parent?.isUpdateExpression() &&
            !parent?.isUnaryExpression({ operator: 'delete' })
          )
        })
        const fields = new Map<string, string>()
        if (safe && project(init, [], fields))
          result.set(name, { fields, options: 'literal-object' })
      }
      p.stop()
    },
  })
  return result
}

/** A read of an object also observes its descendants; a changed ancestor affects every child. */
export function propertyPathsOverlap(a: string, b: string): boolean {
  const left = JSON.parse(a) as string[]
  const right = JSON.parse(b) as string[]
  return left
    .slice(0, Math.min(left.length, right.length))
    .every((key, index) => key === right[index])
}
