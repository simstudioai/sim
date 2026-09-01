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
 * - table references resolve through every way a file can name one: a direct import, a
 *   renamed import, an `import * as schema` member, a `const u = alias(t, 'u')` binding,
 *   and an inline `.from(alias(t, 'u'))` expression.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import ts from '@typescript/typescript6'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCHEMA_PATH = join(ROOT, 'packages/db/schema.ts')
const SCAN_DIRS = [join(ROOT, 'apps'), join(ROOT, 'packages'), join(ROOT, 'scripts')]
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build', 'out'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const MARKER = 'contract-pending('

interface Violation {
  file: string
  line: number
  table: string
  pattern: string
}

interface SyntaxNode extends Record<string, unknown> {
  type: string
  start?: number | null
  end?: number | null
  loc?: { start: { line: number }; end: { line: number } } | null
}

interface CommentNode extends SyntaxNode {
  value: string
}

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

function isCommentNode(value: unknown): value is CommentNode {
  return (
    isSyntaxNode(value) &&
    (value.type === 'CommentLine' || value.type === 'CommentBlock') &&
    typeof value.value === 'string'
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

/** Parses one source file, returning its program and detached comment list. */
function parseSource(
  file: string,
  source: string
): { program: SyntaxNode; comments: CommentNode[] } {
  const syntaxTree = parse(source, {
    sourceFilename: file,
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: [...(extname(file) === '.tsx' ? (['jsx'] as const) : []), 'typescript', 'decorators'],
  })
  const comments = Array.isArray(syntaxTree.comments)
    ? syntaxTree.comments.filter(isCommentNode)
    : []
  return { program: syntaxTree.program as unknown as SyntaxNode, comments }
}

/**
 * Merges runs of adjacent `//` comments into one text so a marker whose prose
 * wraps across lines reads as a single sentence. Block comments already carry
 * their whole body, so each stands alone.
 */
function groupCommentText(comments: CommentNode[]): string[] {
  const ordered = [...comments].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
  const groups: string[] = []
  let run: CommentNode[] = []
  const flush = () => {
    if (run.length > 0) groups.push(run.map((comment) => comment.value).join('\n'))
    run = []
  }
  for (const comment of ordered) {
    if (comment.type === 'CommentBlock') {
      flush()
      groups.push(comment.value)
      continue
    }
    const previous = run.at(-1)
    const contiguous =
      previous && (comment.loc?.start.line ?? 0) === (previous.loc?.end.line ?? 0) + 1
    if (!contiguous) flush()
    run.push(comment)
  }
  flush()
  return groups
}

/**
 * TSDoc blocks that sit on their own line(s) directly above `node`. Only block
 * comments count as column documentation: a `//` run above a column is the
 * table-level contract marker, which describes the table, not that column.
 */
function leadingDocBlocks(node: SyntaxNode): CommentNode[] {
  const leading = Array.isArray(node.leadingComments) ? node.leadingComments : []
  const startLine = node.loc?.start.line ?? 0
  return leading.filter(
    (comment): comment is CommentNode =>
      isCommentNode(comment) &&
      comment.type === 'CommentBlock' &&
      (comment.loc?.end.line ?? 0) < startLine
  )
}

/** Column properties whose TSDoc marks them for the pending drop. */
function readDoomedColumns(columns: SyntaxNode): Set<string> {
  const doomed = new Set<string>()
  const properties = Array.isArray(columns.properties) ? columns.properties : []
  for (const property of properties) {
    if (!isSyntaxNode(property) || property.type !== 'ObjectProperty') continue
    const name = propertyName(property.key)
    if (!name) continue
    const marked = leadingDocBlocks(property).some(
      (comment) => comment.value.includes('@deprecated') || comment.value.includes(MARKER)
    )
    if (marked) doomed.add(name)
  }
  return doomed
}

/**
 * Tables owed a DROP contract, mapped to their doomed columns.
 *
 * A table is guarded when a comment inside its `pgTable(...)` call carries a
 * `contract-pending(` marker that mentions a drop; markers for non-drop
 * contracts (e.g. a pending `SET NOT NULL` normalization) don't make argless
 * reads hazardous and are excluded. A column is doomed when its own TSDoc says
 * `@deprecated` or carries the marker — read from the parsed comment blocks, so
 * single-line and multiline TSDoc are recognized alike.
 */
function readPendingTables(): Map<string, Set<string>> {
  const { program, comments } = parseSource(SCHEMA_PATH, readFileSync(SCHEMA_PATH, 'utf8'))
  const pending = new Map<string, Set<string>>()

  const visit = (node: SyntaxNode) => {
    if (node.type === 'VariableDeclarator') {
      const init = unwrap(node.init)
      const bound = propertyName(node.id)
      if (bound && init?.type === 'CallExpression' && identifierName(init.callee) === 'pgTable') {
        const columns = unwrap(Array.isArray(init.arguments) ? init.arguments[1] : undefined)
        if (columns?.type === 'ObjectExpression') {
          const within = comments.filter(
            (comment) =>
              (comment.start ?? -1) >= (init.start ?? 0) && (comment.end ?? -1) <= (init.end ?? 0)
          )
          const declaresDrop = groupCommentText(within).some(
            (text) => text.includes(MARKER) && /\bdrop\b/i.test(text)
          )
          if (declaresDrop) pending.set(bound, readDoomedColumns(columns))
        }
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)
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
 * How a file can name a pending table: `locals` maps a local binding (a renamed
 * import or an `alias()` result) to its canonical table, and `namespaces` holds
 * `import * as schema` bindings whose members are canonical tables.
 */
interface TableBindings {
  locals: Map<string, string>
  namespaces: Set<string>
}

/**
 * Resolves an expression to the canonical pending-table name it reads, seeing
 * through renamed imports, `import * as schema` members, file-local alias
 * bindings, and inline `alias(t, 'name')` calls.
 */
function resolveTable(
  node: unknown,
  pendingTables: Map<string, Set<string>>,
  bindings: TableBindings
): string | null {
  const unwrapped = unwrap(node)
  if (!unwrapped) return null
  if (unwrapped.type === 'Identifier' && typeof unwrapped.name === 'string') {
    if (pendingTables.has(unwrapped.name)) return unwrapped.name
    return bindings.locals.get(unwrapped.name) ?? null
  }
  if (unwrapped.type === 'MemberExpression' && !unwrapped.computed) {
    const namespace = identifierName(unwrapped.object)
    const member = propertyName(unwrapped.property)
    if (namespace && member && bindings.namespaces.has(namespace) && pendingTables.has(member)) {
      return member
    }
    return null
  }
  if (
    unwrapped.type === 'CallExpression' &&
    identifierName(unwrapped.callee) === 'alias' &&
    Array.isArray(unwrapped.arguments)
  ) {
    return resolveTable(unwrapped.arguments[0], pendingTables, bindings)
  }
  return null
}

/** A module that can export the schema's table objects. */
function isSchemaModule(source: unknown): boolean {
  const value = isSyntaxNode(source) && typeof source.value === 'string' ? source.value : null
  return value !== null && (/@sim\/db(\/|$)/.test(value) || /(^|\/)schema(\.ts)?$/.test(value))
}

/**
 * Collects every way this file can name a pending table: renamed imports,
 * namespace imports, and `const u = alias(pendingTable, ...)` bindings.
 */
function collectTableBindings(
  program: SyntaxNode,
  pendingTables: Map<string, Set<string>>
): TableBindings {
  const bindings: TableBindings = { locals: new Map(), namespaces: new Set() }

  const visitImports = (node: SyntaxNode) => {
    if (node.type === 'ImportDeclaration' && isSchemaModule(node.source)) {
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers : []
      for (const specifier of specifiers) {
        if (!isSyntaxNode(specifier)) continue
        const local = propertyName(specifier.local)
        if (!local) continue
        if (specifier.type === 'ImportNamespaceSpecifier') {
          bindings.namespaces.add(local)
          continue
        }
        if (specifier.type !== 'ImportSpecifier') continue
        const imported = propertyName(specifier.imported)
        if (imported && imported !== local && pendingTables.has(imported)) {
          bindings.locals.set(local, imported)
        }
      }
    }
    for (const child of getChildNodes(node)) visitImports(child)
  }
  visitImports(program)

  /**
   * Any `const x = <table expression>` re-binds the table, whether the right
   * side is the table itself, a namespace member, an earlier binding, or an
   * `alias()` call. Repeats to a fixpoint so a chain of bindings resolves
   * regardless of declaration order; each pass adds at least one binding, and
   * bindings are bounded by the declarator count, so it terminates.
   */
  let changed = true
  while (changed) {
    changed = false
    const visitAssignments = (node: SyntaxNode) => {
      if (node.type === 'VariableDeclarator' && isSyntaxNode(node.init)) {
        const bound = propertyName(node.id)
        if (bound && !bindings.locals.has(bound) && !pendingTables.has(bound)) {
          const canonical = resolveTable(node.init, pendingTables, bindings)
          if (canonical) {
            bindings.locals.set(bound, canonical)
            changed = true
          }
        }
      }
      for (const child of getChildNodes(node)) visitAssignments(child)
    }
    visitAssignments(program)
  }

  return bindings
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
  bindings: TableBindings,
  report: (node: SyntaxNode, table: string, pattern: string) => void
): void {
  const callee = isSyntaxNode(call.callee) ? call.callee : null
  const args = Array.isArray(call.arguments) ? call.arguments : []
  const resolveArg = (node: unknown) => resolveTable(node, pendingTables, bindings)

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

  // <query root>.pendingTable.findFirst/findMany without a `columns` selection.
  // Matched on the table-named property rather than a literal `.query` chain,
  // since drizzle's relational API is keyed by table name however the root is
  // reached — `db.query`, `tx.query`, or a binding holding either.
  if (method === 'findFirst' || method === 'findMany') {
    const queryTable = unwrap(callee.object)
    if (queryTable?.type !== 'MemberExpression' || queryTable.computed) return
    const table = propertyName(queryTable.property)
    if (!table || !pendingTables.has(table)) return
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
    program = parseSource(file, source).program
  } catch (error) {
    violations.push({
      file,
      line: 1,
      table: '(parse error)',
      pattern: `file could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    })
    return violations
  }

  const bindings = collectTableBindings(program, pendingTables)

  const report = (node: SyntaxNode, table: string, pattern: string) => {
    violations.push({ file, line: node.loc?.start.line ?? 1, table, pattern })
  }

  const visit = (node: SyntaxNode, parent: SyntaxNode | null) => {
    if (node.type === 'CallExpression') {
      checkCall(node, parent, pendingTables, bindings, report)
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

export function mayReferencePendingTable(source: string, tableNames: ReadonlySet<string>): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source)
  let hasSchemaModule = false
  let hasTableName = false

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const value = scanner.getTokenValue()
    if (
      (token === ts.SyntaxKind.StringLiteral ||
        token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) &&
      (/@sim\/db(\/|$)/.test(value) || /(^|\/)schema(\.ts)?$/.test(value))
    ) {
      hasSchemaModule = true
    }
    if (token === ts.SyntaxKind.Identifier && tableNames.has(value)) {
      hasTableName = true
    }
    if (hasSchemaModule && hasTableName) return true
  }
  return false
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
  const pendingTableNames = new Set(pendingTables.keys())
  const violations: Violation[] = []
  for (const file of SCAN_DIRS.flatMap((dir) => collectSources(dir))) {
    if (skipFiles.has(file) || /\.test\.(ts|tsx|mts|cts)$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    if (file !== SCHEMA_PATH && !mayReferencePendingTable(source, pendingTableNames)) continue
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

if (import.meta.main) main()
