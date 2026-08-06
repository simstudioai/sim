#!/usr/bin/env bun
/**
 * Fails when a `Date` reaches a raw drizzle `sql` template without a column encoder.
 *
 * `drizzle()` overwrites postgres-js's temporal serializers (OIDs 1082/1083/1114/1184/
 * 1182/1185/1115/1231) with an identity function, because drizzle normally maps timestamps
 * itself through the column's `mapToDriverValue`. A raw `sql` template carries no column
 * context, so an interpolated `Date` skips that mapping, reaches the now-identity serializer
 * unchanged, and the wire encoder throws `ERR_INVALID_ARG_TYPE`. Binding through
 * `sql.param(date, table.column)` restores the column mapping.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCAN_DIRS = [join(ROOT, 'apps'), join(ROOT, 'packages')]
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build', 'out'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const ALLOW_ANNOTATION = '// sql-date-bound:'

interface Violation {
  file: string
  line: number
  expression: string
  reason: string
}

interface SyntaxNode extends Record<string, unknown> {
  type: string
  start?: number | null
  end?: number | null
  loc?: { start: { line: number } } | null
}

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

function getChildNodes(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (const value of Object.values(node)) {
    if (isSyntaxNode(value)) children.push(value)
    else if (Array.isArray(value))
      for (const item of value) if (isSyntaxNode(item)) children.push(item)
  }
  return children
}

function unwrap(node: SyntaxNode): SyntaxNode {
  let current = node
  while (
    (current.type === 'TSAsExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ParenthesizedExpression') &&
    isSyntaxNode(current.expression)
  ) {
    current = current.expression
  }
  return current
}

function isDateAnnotation(annotation: unknown): boolean {
  if (!isSyntaxNode(annotation)) return false
  if (annotation.type === 'TSTypeAnnotation') return isDateAnnotation(annotation.typeAnnotation)
  if (annotation.type === 'TSUnionType' && Array.isArray(annotation.types))
    return annotation.types.some(isDateAnnotation)
  return (
    annotation.type === 'TSTypeReference' &&
    isSyntaxNode(annotation.typeName) &&
    annotation.typeName.name === 'Date'
  )
}

/** `new Date(...)` plus the expression forms that trivially forward one. */
function isDateExpression(node: unknown, dateNames: ReadonlySet<string>): boolean {
  if (!isSyntaxNode(node)) return false
  const current = unwrap(node)
  if (current.type === 'NewExpression')
    return isSyntaxNode(current.callee) && current.callee.name === 'Date'
  if (current.type === 'Identifier')
    return typeof current.name === 'string' && dateNames.has(current.name)
  if (current.type === 'ConditionalExpression')
    return (
      isDateExpression(current.consequent, dateNames) ||
      isDateExpression(current.alternate, dateNames)
    )
  if (current.type === 'LogicalExpression')
    return isDateExpression(current.left, dateNames) || isDateExpression(current.right, dateNames)
  return false
}

/**
 * Names bound to a `Date` anywhere in the file. The pass over-approximates scope — a name
 * declared in one function marks same-named bindings elsewhere — which keeps the audit
 * blind-spot-free at the cost of flagging a shadowed non-Date, resolvable by renaming.
 */
function collectDateNames(program: SyntaxNode): Set<string> {
  const names = new Set<string>()
  let changed = true

  const visit = (node: SyntaxNode) => {
    const isBinding =
      node.type === 'VariableDeclarator' ||
      node.type === 'ClassProperty' ||
      node.type === 'PropertyDefinition'
    if (isBinding && isSyntaxNode(node.id ?? node.key)) {
      const target = (node.id ?? node.key) as SyntaxNode
      if (
        target.type === 'Identifier' &&
        typeof target.name === 'string' &&
        (isDateAnnotation(target.typeAnnotation ?? node.typeAnnotation) ||
          isDateExpression(node.init ?? node.value, names))
      ) {
        if (!names.has(target.name)) {
          names.add(target.name)
          changed = true
        }
      }
    }
    if (
      (node.type === 'Identifier' && isDateAnnotation(node.typeAnnotation)) ||
      (node.type === 'TSPropertySignature' && isDateAnnotation(node.typeAnnotation))
    ) {
      const name = isSyntaxNode(node.key) ? node.key.name : node.name
      if (typeof name === 'string' && !names.has(name)) {
        names.add(name)
        changed = true
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }

  /** Re-run until stable so `const b = a` chains resolve regardless of declaration order. */
  while (changed) {
    changed = false
    visit(program)
  }
  return names
}

function isSqlIdentifier(node: unknown): boolean {
  return isSyntaxNode(node) && node.type === 'Identifier' && node.name === 'sql'
}

/** Matches `` sql`…` `` and `` sql<T>`…` `` (the generic wraps the tag in TSInstantiationExpression). */
function isSqlTag(node: unknown): boolean {
  if (isSqlIdentifier(node)) return true
  return (
    isSyntaxNode(node) &&
    node.type === 'TSInstantiationExpression' &&
    isSqlIdentifier(node.expression)
  )
}

function isSqlParamCall(node: SyntaxNode): boolean {
  const callee = isSyntaxNode(node.callee) ? unwrap(node.callee) : undefined
  return Boolean(
    callee &&
      callee.type === 'MemberExpression' &&
      isSyntaxNode(callee.property) &&
      callee.property.name === 'param' &&
      isSqlIdentifier(callee.object)
  )
}

/**
 * A violation is excused only when the preceding line is a line comment whose
 * text is exactly the documented annotation followed by a non-empty reason.
 * Matching the marker anywhere on the line would let unrelated code — or a
 * bare marker with no justification — silently disable the audit.
 */
function isAllowAnnotation(line: string | undefined): boolean {
  const trimmed = (line ?? '').trim()
  if (!trimmed.startsWith(ALLOW_ANNOTATION)) return false
  return trimmed.slice(ALLOW_ANNOTATION.length).trim().length > 0
}

export function findSqlDateBindingViolations(source: string, file = 'source.ts'): Violation[] {
  const syntaxTree = parse(source, {
    sourceFilename: file,
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: [...(extname(file) === '.tsx' ? (['jsx'] as const) : []), 'typescript'],
  })
  const program = syntaxTree.program as unknown as SyntaxNode
  const dateNames = collectDateNames(program)
  const lines = source.split('\n')
  const violations: Violation[] = []

  const report = (node: SyntaxNode, reason: string) => {
    if (typeof node.start !== 'number' || typeof node.end !== 'number' || !node.loc) return
    const line = node.loc.start.line
    if (isAllowAnnotation(lines[line - 2])) return
    violations.push({ file, line, expression: source.slice(node.start, node.end), reason })
  }

  const visit = (node: SyntaxNode) => {
    if (node.type === 'TaggedTemplateExpression' && isSqlTag(node.tag)) {
      const quasi = isSyntaxNode(node.quasi) ? node.quasi : undefined
      const expressions = Array.isArray(quasi?.expressions) ? quasi.expressions : []
      for (const expression of expressions) {
        if (isDateExpression(expression, dateNames)) {
          report(
            expression as SyntaxNode,
            'a Date interpolated into a raw sql template has no encoder; bind it with sql.param(date, table.column)'
          )
        }
      }
    }
    if (node.type === 'CallExpression' && isSqlParamCall(node)) {
      const args = Array.isArray(node.arguments) ? node.arguments : []
      if (args.length === 1 && isDateExpression(args[0], dateNames)) {
        report(
          args[0] as SyntaxNode,
          'sql.param(date) has no encoder; pass the column as the second argument'
        )
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)

  return violations
}

function collectSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectSources(path, found)
    else if (SOURCE_EXTENSIONS.has(extname(path)) && !path.endsWith('.d.ts')) found.push(path)
  }
  return found
}

function main(): void {
  const files = SCAN_DIRS.flatMap((dir) => collectSources(dir))
  const violations = files.flatMap((file) =>
    findSqlDateBindingViolations(readFileSync(file, 'utf8'), file)
  )

  if (violations.length > 0) {
    console.error('Unbound Date values reach postgres-js through raw sql templates:')
    for (const violation of violations) {
      console.error(
        `  ${relative(ROOT, violation.file)}:${violation.line}  ${violation.expression}\n    ${violation.reason}`
      )
    }
    console.error(
      `\nDrizzle replaces postgres-js's temporal serializers with an identity function and maps` +
        `\ntimestamps itself, so a Date outside column context is never serialized. Bind through` +
        `\nthe column: sql.param(date, table.column). Annotate a genuine exception with` +
        `\n${ALLOW_ANNOTATION} <reason> on the preceding line.`
    )
    process.exit(1)
  }

  console.log(`✓ ${files.length} files bind every sql-template Date through a column encoder`)
}

if (import.meta.main) main()
