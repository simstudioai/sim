import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import traverseModule, { type NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import { normalizeLiteralAliases, normalizeRefactors } from '#design-diff/refactors'
import type { Data, Location } from '#design-diff/types'

/** Handles Babel's CommonJS interop consistently in Bun and Vitest. */
export const traverse: typeof traverseModule =
  typeof traverseModule === 'function'
    ? traverseModule
    : (traverseModule as unknown as { default: typeof traverseModule }).default

/** Parse import/reference syntax without doing the resolver's literal/refactor work. */
export function parseSyntax(source: string, file: string) {
  return parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: file,
    plugins: ['jsx', 'typescript', 'decorators-legacy'],
    errorRecovery: false,
    attachComment: false,
  })
}

export function parseSource(source: string, file: string) {
  const ast = parseSyntax(source, file)
  normalizeRefactors(ast, traverse)
  normalizeLiteralAliases(ast, traverse)
  return ast
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
    /** Babel builders and parsed nodes spell absent optional fields differently. */
    if (
      (key === 'optional' && /Expression$/.test(String(node.type)) && !node[key]) ||
      (key === 'method' && node.type === 'ObjectProperty' && node[key] === false) ||
      (['id', 'generator', 'expression'].includes(key) &&
        node.type === 'ArrowFunctionExpression' &&
        !node[key])
    )
      continue
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

/** JSON data has no erased AST fields: retain every key and meaningful array order. */
export function canonicalJson(value: Data): Data {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])])
  )
}

/** React's line-wise JSX text whitespace semantics, including explicit single-line spaces. */
export function jsxText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let last = 0
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) last = i
  })
  return lines
    .map((line, i) => {
      let value = line.replace(/\t/g, ' ')
      if (i !== 0) value = value.replace(/^ +/, '')
      if (i !== lines.length - 1) value = value.replace(/ +$/, '')
      return value ? value + (i !== last ? ' ' : '') : ''
    })
    .join('')
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

const fingerprints = new WeakMap<object, string>()

/** Source ASTs are immutable; repeated references share their complete semantic hash. */
export function fingerprint(value: unknown): string {
  const cached = value && typeof value === 'object' ? fingerprints.get(value) : undefined
  if (cached) return cached
  const hash = createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
  if (value && typeof value === 'object') fingerprints.set(value, hash)
  return hash
}
