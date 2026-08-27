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
 * The audit derives everything from schema.ts itself and retires when the contract PR
 * deletes the markers:
 * - guarded tables = `pgTable`s carrying a drop-flavored `contract-pending(` marker;
 * - each table's doomed columns = declarations tagged `@deprecated` (or carrying the
 *   `contract-pending` marker directly, e.g. `workspace_files.size`);
 * - the sanctioned live-column builders — `omit(getTableColumns(t), [...])` and
 *   `const { doomed, ...live } = getTableColumns(t)` — are validated against that
 *   doomed set, so an omit list that misses a doomed column (including one deprecated
 *   later) fails here, in schema.ts's own `<table>Columns` helpers too;
 * - `alias(t, ...)` is resolved through both `const u = alias(t, 'u')` bindings and
 *   inline `.from(alias(t, 'u'))` expressions.
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
const COLUMN_DECLARATION = /^\s+(\w+):/
const DOOMED_TAG = /^\s*(?:\/\*\*\s*@deprecated|\/\*\*\s*contract-pending\()/

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
 * Tables owed a DROP contract, mapped to their doomed columns.
 *
 * A table is guarded when its body carries a `contract-pending(` marker that
 * mentions a drop; markers for non-drop contracts (e.g. a pending `SET NOT
 * NULL` normalization) don't make argless reads hazardous and are excluded. A
 * column is doomed when its declaration sits directly under an `@deprecated`
 * TSDoc line or carries the `contract-pending` marker itself.
 */
function readPendingTables(): Map<string, Set<string>> {
  const doomedByTable = new Map<string, Set<string>>()
  const pending = new Set<string>()
  const lines = readFileSync(SCHEMA_PATH, 'utf8').split('\n')
  let currentTable: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const exported = TABLE_EXPORT.exec(lines[i])
    if (exported) {
      currentTable = exported[1]
      continue
    }
    if (!currentTable) continue
    if (lines[i].includes(MARKER)) {
      const markerText = `${lines[i]}\n${lines[i + 1] ?? ''}`
      if (/\bdrop\b/i.test(markerText)) pending.add(currentTable)
    }
    if (DOOMED_TAG.test(lines[i])) {
      const declaration = COLUMN_DECLARATION.exec(lines[i + 1] ?? '')
      if (declaration) {
        const doomed = doomedByTable.get(currentTable) ?? new Set<string>()
        doomed.add(declaration[1])
        doomedByTable.set(currentTable, doomed)
      }
    }
  }
  const result = new Map<string, Set<string>>()
  for (const table of pending) result.set(table, doomedByTable.get(table) ?? new Set())
  return result
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
 * Resolves an expression to the canonical pending-table name it reads, seeing
 * through file-local alias bindings and inline `alias(t, 'name')` calls.
 */
function resolveTable(
  node: unknown,
  pendingTables: Map<string, Set<string>>,
  aliases: Map<string, string>
): string | null {
  const unwrapped = unwrap(node)
  if (!unwrapped) return null
  if (unwrapped.type === 'Identifier' && typeof unwrapped.name === 'string') {
    if (pendingTables.has(unwrapped.name)) return unwrapped.name
    return aliases.get(unwrapped.name) ?? null
  }
  if (
    unwrapped.type === 'CallExpression' &&
    identifierName(unwrapped.callee) === 'alias' &&
    Array.isArray(unwrapped.arguments)
  ) {
    return resolveTable(unwrapped.arguments[0], pendingTables, aliases)
  }
  return null
}

/** Maps `const u = alias(pendingTable, ...)` bindings to their canonical table. */
function collectAliasBindings(
  program: SyntaxNode,
  pendingTables: Map<string, Set<string>>
): Map<string, string> {
  const aliases = new Map<string, string>()
  const visit = (node: SyntaxNode) => {
    if (node.type === 'VariableDeclarator' && isSyntaxNode(node.init)) {
      const init = unwrap(node.init)
      if (init?.type === 'CallExpression' && identifierName(init.callee) === 'alias') {
        const canonical = resolveTable(
          Array.isArray(init.arguments) ? init.arguments[0] : undefined,
          pendingTables,
          aliases
        )
        const bound = propertyName(node.id)
        if (canonical && bound) aliases.set(bound, canonical)
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)
  return aliases
}

/**
 * Validates the sanctioned live-column builders around a `getTableColumns(t)`
 * call: `omit(getTableColumns(t), ['doomed', ...])` (the `<table>Columns`
 * helpers in schema.ts, e.g. `workspaceFileColumns`) and
 * `const { doomed, ...live } = getTableColumns(t)`. Returns `null` when the
 * surrounding form is not a sanctioned builder at all, otherwise the doomed
 * columns the builder fails to name away — `[]` means fully sanctioned. Any
 * non-literal omit entry or computed destructuring key is unverifiable and
 * counts as unsanctioned.
 */
function sanctionedOmitMissing(parent: SyntaxNode | null, doomed: Set<string>): string[] | null {
  if (!parent) return null
  if (parent.type === 'CallExpression' && identifierName(parent.callee) === 'omit') {
    const omitKeys = unwrap(Array.isArray(parent.arguments) ? parent.arguments[1] : undefined)
    if (omitKeys?.type !== 'ArrayExpression' || !Array.isArray(omitKeys.elements)) return null
    const omitted = new Set<string>()
    for (const element of omitKeys.elements) {
      const literal = unwrap(element)
      if (literal?.type !== 'StringLiteral' || typeof literal.value !== 'string') return null
      omitted.add(literal.value)
    }
    if (omitted.size === 0) return null
    return [...doomed].filter((column) => !omitted.has(column))
  }
  if (parent.type !== 'VariableDeclarator' || !isSyntaxNode(parent.id)) return null
  const pattern = parent.id
  if (pattern.type !== 'ObjectPattern' || !Array.isArray(pattern.properties)) return null
  const named = new Set<string>()
  let rest = 0
  for (const property of pattern.properties) {
    if (!isSyntaxNode(property)) continue
    if (property.type === 'RestElement') {
      rest++
      continue
    }
    if (property.type !== 'ObjectProperty') return null
    const key = propertyName(property.key)
    if (!key) return null
    named.add(key)
  }
  if (named.size === 0 || rest !== 1) return null
  return [...doomed].filter((column) => !named.has(column))
}

function checkCall(
  call: SyntaxNode,
  parent: SyntaxNode | null,
  pendingTables: Map<string, Set<string>>,
  aliases: Map<string, string>,
  report: (node: SyntaxNode, table: string, pattern: string) => void
): void {
  const callee = isSyntaxNode(call.callee) ? call.callee : null
  const args = Array.isArray(call.arguments) ? call.arguments : []
  const resolveArg = (node: unknown) => resolveTable(node, pendingTables, aliases)

  // getTableColumns(pendingTable) — spreads every declared column unless the
  // doomed ones are verifiably named away on the spot.
  if (identifierName(callee) === 'getTableColumns') {
    const table = resolveArg(args[0])
    if (!table) return
    const missing = sanctionedOmitMissing(parent, pendingTables.get(table) ?? new Set())
    if (missing === null) {
      report(call, table, 'getTableColumns() spreads all columns (omit the doomed columns away)')
    } else if (missing.length > 0) {
      report(call, table, `live-column builder misses doomed column(s): ${missing.join(', ')}`)
    }
    return
  }

  if (callee?.type !== 'MemberExpression') return
  const method = propertyName(callee.property)

  // <builder>.select()/.selectDistinct() ... .from(pendingTable) with no selection.
  if (method === 'from') {
    const table = resolveArg(args[0])
    if (!table) return
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
    if (!table || !pendingTables.has(table)) return
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
        const table = resolveArg(chainArgs[0])
        if (table) {
          report(call, table, 'argless .returning() returns all columns')
        }
        break
      }
    }
  }
}

function auditFile(
  file: string,
  source: string,
  pendingTables: Map<string, Set<string>>
): Violation[] {
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

  const aliases = collectAliasBindings(program, pendingTables)

  const report = (node: SyntaxNode, table: string, pattern: string) => {
    violations.push({ file, line: node.loc?.start.line ?? 1, table, pattern })
  }

  const visit = (node: SyntaxNode, parent: SyntaxNode | null) => {
    if (node.type === 'CallExpression') {
      checkCall(node, parent, pendingTables, aliases, report)
    }
    for (const child of getChildNodes(node)) visit(child, node)
  }
  visit(program, null)
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
  const pendingTables = readPendingTables()
  if (pendingTables.size === 0) {
    console.log('✓ No contract-pending tables in schema.ts; nothing to enforce.')
    return
  }

  // schema.ts is deliberately NOT skipped: its own `<table>Columns` helpers
  // must keep naming every doomed column away, including ones deprecated later.
  const skipFiles = new Set([fileURLToPath(import.meta.url)])
  const namePattern = new RegExp(`\\b(${[...pendingTables.keys()].join('|')}|alias)\\b`)
  const violations: Violation[] = []
  for (const file of SCAN_DIRS.flatMap((dir) => collectSources(dir))) {
    if (skipFiles.has(file) || /\.test\.(ts|tsx|mts|cts)$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    if (!namePattern.test(source)) continue
    violations.push(...auditFile(file, source, pendingTables))
  }

  if (violations.length === 0) {
    console.log(
      `✓ No argless reads of pending-drop tables (${[...pendingTables.keys()].sort().join(', ')}).`
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
