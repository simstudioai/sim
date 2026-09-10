import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import traverseModule, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { Data, Location } from '#design-diff/types'

/** Handles Babel's CommonJS interop consistently in Bun and Vitest. */
export const traverse: typeof traverseModule =
  typeof traverseModule === 'function'
    ? traverseModule
    : (traverseModule as unknown as { default: typeof traverseModule }).default

export function parseSource(source: string, file: string) {
  return parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: file,
    plugins: ['jsx', 'typescript', 'decorators-legacy'],
    errorRecovery: false,
    attachComment: false,
  })
}

/** Removes syntax trivia and erased types, retaining runtime ordering and literal whitespace. */
export function canonical(value: unknown): Data {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object') return null
  const node = value as Record<string, unknown>
  if (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TypeCastExpression',
    ].includes(String(node.type))
  )
    return canonical(node.expression)
  const result: Record<string, Data> = Object.create(null)
  for (const key of Object.keys(node).sort()) {
    if (
      [
        'start',
        'end',
        'loc',
        'extra',
        'comments',
        'leadingComments',
        'trailingComments',
        'innerComments',
        'typeAnnotation',
        'typeParameters',
        'typeArguments',
        'returnType',
        'declare',
        'accessibility',
        'readonly',
        'abstract',
        'definite',
        'implements',
      ].includes(key)
    )
      continue
    result[key] = canonical(node[key])
  }
  return result
}

export function location(file: string, node?: t.Node | null): Location {
  return { file, line: node?.loc?.start.line ?? 1, column: (node?.loc?.start.column ?? 0) + 1 }
}

export function propertyName(node: t.Node | null | undefined): string {
  if (t.isIdentifier(node) || t.isJSXIdentifier(node)) return node.name
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return String(node.value)
  if (t.isJSXMemberExpression(node))
    return `${propertyName(node.object)}.${propertyName(node.property)}`
  if (t.isJSXNamespacedName(node))
    return `${propertyName(node.namespace)}:${propertyName(node.name)}`
  return '?'
}

export function symbolName(path: NodePath): string {
  let current: NodePath | null = path
  while (current) {
    if (current.isFunctionDeclaration() && current.node.id) return current.node.id.name
    if (current.isVariableDeclarator()) return propertyName(current.node.id)
    current = current.parentPath
  }
  return 'module'
}

export function semanticSource(source: string, file: string): string {
  const ast = parseSource(source, file)
  traverse(ast, {
    enter(path) {
      if (
        path.isTSTypeAliasDeclaration() ||
        path.isTSInterfaceDeclaration() ||
        path.isTSDeclareFunction() ||
        (path.isImportDeclaration() && path.node.importKind === 'type')
      )
        path.remove()
    },
  })
  return JSON.stringify(canonical(ast.program))
}

/** Compact evidence for unsupported syntax without duplicating entire function bodies. */
export function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
