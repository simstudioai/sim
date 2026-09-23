import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { propertyName } from '#design-diff/ast'
import { immutableCollection } from '#design-diff/mutations'
import type { Resolver } from '#design-diff/resolve'

interface Source {
  path: NodePath
  file: string
}
const child = (path: NodePath, name: string) => path.get(name) as NodePath
const children = (path: NodePath, name: string) => path.get(name) as NodePath[]

/** Bound computed keys from immutable literals and static Object.entries/values loops. No loop or source function executes. */
export function finiteKeys(path: NodePath, file: string, resolver: Resolver) {
  const dependencies = new Set<string>()
  let steps = 0
  let mutable = false
  const sources = (source: Source, active = new Set<t.Node>()): Source[] | undefined => {
    const { path, file } = source
    if (!path.node || ++steps > 512 || active.size > 24 || active.has(path.node)) return undefined
    const seen = new Set([...active, path.node])
    dependencies.add(file)
    const next = (path: NodePath, from = file) => sources({ path, file: from }, seen)
    if (path.isTSAsExpression() || path.isTSSatisfiesExpression() || path.isTSNonNullExpression())
      return next(child(path, 'expression'))
    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(path.node.name)
      if (!binding) return undefined
      if (!immutableCollection(binding)) {
        mutable = true
        return undefined
      }
      const bound = binding.path
      if (bound.isVariableDeclarator()) {
        if (bound.node.init) return next(child(bound, 'init'))
        const loop = bound.parentPath.parentPath
        if (!loop?.isForOfStatement() || loop.node.await) return undefined
        let right = child(loop, 'right')
        while (
          right.isTSAsExpression() ||
          right.isTSSatisfiesExpression() ||
          right.isTSNonNullExpression()
        )
          right = child(right, 'expression')
        if (!right.isCallExpression()) return undefined
        const callee = child(right, 'callee')
        if (
          !callee.isMemberExpression() ||
          callee.node.computed ||
          !t.isIdentifier(callee.node.object, { name: 'Object' }) ||
          callee.scope.getBinding('Object')
        )
          return undefined
        const method = propertyName(callee.node.property)
        const args = children(right, 'arguments')
        if (args.length !== 1 || !['entries', 'values'].includes(method)) return undefined
        let index = -1
        if (method === 'entries' && t.isArrayPattern(bound.node.id))
          index = bound.node.id.elements.findIndex((node) =>
            t.isIdentifier(node, { name: path.node.name })
          )
        if (method === 'values' && t.isIdentifier(bound.node.id, { name: path.node.name }))
          index = 1
        if (index !== 1) return undefined
        const records = next(args[0])
        if (!records || records.length > 128) return undefined
        const result: Source[] = []
        for (const record of records) {
          if (!record.path.isObjectExpression()) return undefined
          for (const property of children(record.path, 'properties')) {
            if (!property.isObjectProperty() || property.node.computed) return undefined
            result.push({ path: child(property, 'value'), file: record.file })
            if (result.length > 128) return undefined
          }
        }
        return result
      }
      if (bound.isImportSpecifier() || bound.isImportDefaultSpecifier()) {
        const declaration = bound.parentPath
        if (!declaration.isImportDeclaration()) return undefined
        const target = resolver.tree.resolve(file, declaration.node.source.value)
        const name = bound.isImportSpecifier() ? propertyName(bound.node.imported) : 'default'
        const resolved = target ? resolver.tree.graph?.resolvedExport(target, name) : undefined
        if (!resolved?.origin) return undefined
        for (const route of resolved.routes) dependencies.add(route)
        const exported = resolver.module(resolved.origin.file).exports.get(resolved.origin.exported)
        if (
          exported?.parentPath?.isVariableDeclarator() &&
          t.isIdentifier(exported.parentPath.node.id)
        ) {
          const binding = exported.scope.getBinding(exported.parentPath.node.id.name)
          if (binding && !immutableCollection(binding)) {
            mutable = true
            return undefined
          }
        }
        return exported ? next(exported, resolved.origin.file) : undefined
      }
      return undefined
    }
    if (
      path.isMemberExpression() &&
      (!path.node.computed || t.isStringLiteral(path.node.property))
    ) {
      const key = propertyName(path.node.property)
      const records = next(child(path, 'object'))
      if (!records || records.length > 128) return undefined
      const result: Source[] = []
      for (const record of records) {
        if (!record.path.isObjectExpression()) return undefined
        const properties = children(record.path, 'properties')
        if (properties.some((prop) => !prop.isObjectProperty() || prop.node.computed))
          return undefined
        const property = properties
          .reverse()
          .find((prop) => prop.isObjectProperty() && propertyName(prop.node.key) === key)
        if (!property) return undefined
        const values = sources({ path: child(property, 'value'), file: record.file }, seen)
        if (!values) return undefined
        result.push(...values)
      }
      return result
    }
    return [source]
  }
  try {
    const values = sources({ path, file })
    if (!values?.length || values.length > 128)
      return mutable
        ? { keys: undefined, dependencies: [...dependencies].sort(), mutable: true }
        : undefined
    const keys: (string | number)[] = []
    for (const value of values) {
      if (!value.path.isStringLiteral() && !value.path.isNumericLiteral()) return undefined
      keys.push(value.path.node.value)
    }
    return { keys: [...new Set(keys)], dependencies: [...dependencies].sort() }
  } catch {
    return undefined
  }
}
