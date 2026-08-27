#!/usr/bin/env bun
/**
 * Fails when app code reads a pending-drop table without naming its columns.
 *
 * A `contract-pending` marker inside a table in `packages/db/schema.ts` means the table
 * still declares columns whose physical `DROP COLUMN` is deferred until the app version
 * that stops emitting them is fully deployed. Drizzle compiles argless reads into an
 * explicit list of EVERY declared column — `select().from(t)`, `db.query.t.findFirst()`
 * without `columns`, an argless `.returning()`, a `getTableColumns(t)` spread — so a
 * single argless read puts the doomed columns back into live SQL and would fail with
 * 42703 against the already-migrated database for the whole cutover window of the
 * contract deploy. Reads of these tables must name the columns they want.
 *
 * The pending-table set is derived from the markers themselves, so this audit enforces
 * nothing (and needs no cleanup) once the contract PR deletes them.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCHEMA_PATH = join(ROOT, 'packages/db/schema.ts')
const SCAN_DIRS = [join(ROOT, 'apps'), join(ROOT, 'packages'), join(ROOT, 'scripts')]
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build', 'out'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const MARKER = 'contract-pending('
const TABLE_EXPORT = /^export const (\w+) = pgTable\(/

interface Violation {
  file: string
  line: number
  table: string
  pattern: string
}

interface SyntaxNode extends Record<string, unknown> {
  type: string
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

function unwrap(node: unknown): SyntaxNode | null {
  if (!isSyntaxNode(node)) return null
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

/**
 * Tables owed a DROP contract: every `pgTable` whose body carries a
 * `contract-pending(` marker that mentions a drop, keyed by the exported
 * drizzle binding name. Markers for non-drop contracts (e.g. a pending
 * `SET NOT NULL` normalization) don't make argless reads hazardous and are
 * excluded — dropping nothing means no column can vanish out from under a
 * generated SELECT list.
 */
function readPendingTables(): Set<string> {
  const pending = new Set<string>()
  const lines = readFileSync(SCHEMA_PATH, 'utf8').split('\n')
  let currentTable: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const exported = TABLE_EXPORT.exec(lines[i])
    if (exported) currentTable = exported[1]
    else if (lines[i].includes(MARKER) && currentTable) {
      const markerText = `${lines[i]}\n${lines[i + 1] ?? ''}`
      if (/\bdrop\b/i.test(markerText)) pending.add(currentTable)
    }
  }
  return pending
}

function identifierName(node: unknown): string | null {
  const unwrapped = unwrap(node)
  return unwrapped?.type === 'Identifier' && typeof unwrapped.name === 'string'
    ? unwrapped.name
    : null
}

function propertyName(node: unknown): string | null {
  if (!isSyntaxNode(node)) return null
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name
  return null
}

/** Object-key names of an ObjectExpression argument, for the `columns:` check. */
function objectKeys(node: unknown): Set<string> | null {
  const unwrapped = unwrap(node)
  if (unwrapped?.type !== 'ObjectExpression' || !Array.isArray(unwrapped.properties)) return null
  const keys = new Set<string>()
  for (const property of unwrapped.properties) {
    if (!isSyntaxNode(property)) continue
    const key = propertyName(property.key)
    if (key) keys.add(key)
  }
  return keys
}

/**
 * Audits one file against `pendingTables`, extended per-file with local
 * `alias(pendingTable, ...)` bindings, which select all columns just the same.
 */
function auditFile(file: string, source: string, pendingTables: Set<string>): Violation[] {
  const violations: Violation[] = []
  let program: SyntaxNode
  try {
    const syntaxTree = parse(source, {
      sourceFilename: file,
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: [
        ...(extname(file) === '.tsx' ? (['jsx'] as const) : []),
        'typescript',
        'decorators',
      ],
    })
    program = syntaxTree.program as unknown as SyntaxNode
  } catch (error) {
    violations.push({
      file,
      line: 1,
      table: '(parse error)',
      pattern: `file could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    })
    return violations
  }

  const tables = new Set(pendingTables)
  collectAliasBindings(program, tables)

  const report = (node: SyntaxNode, table: string, pattern: string) => {
    violations.push({ file, line: node.loc?.start.line ?? 1, table, pattern })
  }

  const visit = (node: SyntaxNode, parent: SyntaxNode | null) => {
    if (node.type === 'CallExpression') {
      checkCall(node, parent, tables, report)
    }
    for (const child of getChildNodes(node)) visit(child, node)
  }
  visit(program, null)
  return violations
}

/** Adds `const x = alias(pendingTable, ...)` bindings to the file's pending set. */
function collectAliasBindings(program: SyntaxNode, tables: Set<string>): void {
  const visit = (node: SyntaxNode) => {
    if (node.type === 'VariableDeclarator' && isSyntaxNode(node.init)) {
      const init = unwrap(node.init)
      if (
        init?.type === 'CallExpression' &&
        identifierName(init.callee) === 'alias' &&
        Array.isArray(init.arguments)
      ) {
        const source = identifierName(init.arguments[0])
        const bound = propertyName(node.id)
        if (source && bound && tables.has(source)) tables.add(bound)
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)
}

/**
 * `omit(getTableColumns(t), ['doomed', ...])` (the `<table>Columns` helpers in
 * schema.ts, e.g. `workspaceFileColumns`) and
 * `const { doomed, ...live } = getTableColumns(t)` are the sanctioned ways to
 * build a live-columns selection: both name an explicit
 * subset away and never put the omitted columns into SQL. Anything else that
 * touches `getTableColumns(pendingTable)` selects every declared column
 * somewhere.
 */
function isSanctionedOmit(parent: SyntaxNode | null): boolean {
  if (!parent) return false
  if (parent.type === 'CallExpression' && identifierName(parent.callee) === 'omit') {
    const omitKeys = unwrap(Array.isArray(parent.arguments) ? parent.arguments[1] : undefined)
    return (
      omitKeys?.type === 'ArrayExpression' &&
      Array.isArray(omitKeys.elements) &&
      omitKeys.elements.length > 0
    )
  }
  if (parent.type !== 'VariableDeclarator' || !isSyntaxNode(parent.id)) return false
  const pattern = parent.id
  if (pattern.type !== 'ObjectPattern' || !Array.isArray(pattern.properties)) return false
  const named = pattern.properties.filter(
    (property) => isSyntaxNode(property) && property.type === 'ObjectProperty'
  )
  const rest = pattern.properties.filter(
    (property) => isSyntaxNode(property) && property.type === 'RestElement'
  )
  return named.length > 0 && rest.length === 1
}

function checkCall(
  call: SyntaxNode,
  parent: SyntaxNode | null,
  tables: Set<string>,
  report: (node: SyntaxNode, table: string, pattern: string) => void
): void {
  const callee = isSyntaxNode(call.callee) ? call.callee : null
  const args = Array.isArray(call.arguments) ? call.arguments : []

  // getTableColumns(pendingTable) — spreads every declared column unless the
  // doomed ones are destructured away on the spot.
  if (identifierName(callee) === 'getTableColumns') {
    const table = identifierName(args[0])
    if (table && tables.has(table) && !isSanctionedOmit(parent)) {
      report(call, table, 'getTableColumns() spreads all columns (omit the doomed columns away)')
    }
    return
  }

  if (callee?.type !== 'MemberExpression') return
  const method = propertyName(callee.property)

  // <builder>.select()/.selectDistinct() ... .from(pendingTable) with no selection.
  if (method === 'from') {
    const table = identifierName(args[0])
    if (!table || !tables.has(table)) return
    const receiver = unwrap(callee.object)
    if (receiver?.type !== 'CallExpression') return
    const receiverCallee = isSyntaxNode(receiver.callee) ? receiver.callee : null
    if (receiverCallee?.type !== 'MemberExpression') return
    const selectMethod = propertyName(receiverCallee.property)
    const selectArgs = Array.isArray(receiver.arguments) ? receiver.arguments : []
    if (
      ((selectMethod === 'select' || selectMethod === 'selectDistinct') &&
        selectArgs.length === 0) ||
      (selectMethod === 'selectDistinctOn' && selectArgs.length < 2)
    ) {
      report(call, table, `argless ${selectMethod}() selects all columns`)
    }
    return
  }

  // <db|tx>.query.pendingTable.findFirst/findMany without a `columns` selection.
  if (method === 'findFirst' || method === 'findMany') {
    const queryTable = unwrap(callee.object)
    if (queryTable?.type !== 'MemberExpression') return
    const table = propertyName(queryTable.property)
    if (!table || !tables.has(table)) return
    const queryNamespace = unwrap(queryTable.object)
    if (
      queryNamespace?.type !== 'MemberExpression' ||
      propertyName(queryNamespace.property) !== 'query'
    ) {
      return
    }
    const keys = objectKeys(args[0])
    if (!keys || !keys.has('columns')) {
      report(call, table, `${method}() without \`columns\` selects all columns`)
    }
    return
  }

  // insert/update/delete(pendingTable) ... .returning() with no selection.
  if (method === 'returning' && args.length === 0) {
    for (
      let current = unwrap(callee.object);
      current;
      current =
        current.type === 'CallExpression'
          ? isSyntaxNode(current.callee) && current.callee.type === 'MemberExpression'
            ? unwrap(current.callee.object)
            : null
          : null
    ) {
      if (current.type !== 'CallExpression') break
      const chainCallee = isSyntaxNode(current.callee) ? current.callee : null
      if (chainCallee?.type !== 'MemberExpression') break
      const chainMethod = propertyName(chainCallee.property)
      if (chainMethod === 'insert' || chainMethod === 'update' || chainMethod === 'delete') {
        const chainArgs = Array.isArray(current.arguments) ? current.arguments : []
        const table = identifierName(chainArgs[0])
        if (table && tables.has(table)) {
          report(call, table, 'argless .returning() returns all columns')
        }
        break
      }
    }
  }
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
  const pendingTables = readPendingTables()
  if (pendingTables.size === 0) {
    console.log('✓ No contract-pending tables in schema.ts; nothing to enforce.')
    return
  }

  const skipFiles = new Set([SCHEMA_PATH, fileURLToPath(import.meta.url)])
  const namePattern = new RegExp(`\\b(${[...pendingTables].join('|')}|alias)\\b`)
  const violations: Violation[] = []
  for (const file of SCAN_DIRS.flatMap((dir) => collectSources(dir))) {
    if (skipFiles.has(file) || /\.test\.(ts|tsx|mts|cts)$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    if (!namePattern.test(source)) continue
    violations.push(...auditFile(file, source, pendingTables))
  }

  if (violations.length === 0) {
    console.log(
      `✓ No argless reads of pending-drop tables (${[...pendingTables].sort().join(', ')}).`
    )
    return
  }

  console.error(
    `❌ Found ${violations.length} read(s) of pending-drop tables that select every declared column.\n` +
      'These tables carry a `contract-pending` marker in packages/db/schema.ts: deprecated\n' +
      'columns are awaiting DROP, and an argless read would re-introduce them into live SQL\n' +
      'and 42703 during the contract deploy. Name the live columns explicitly instead.\n'
  )
  for (const violation of violations) {
    console.error(
      `  ${relative(ROOT, violation.file)}:${violation.line} [${violation.table}] ${violation.pattern}`
    )
  }
  process.exit(1)
}

main()
