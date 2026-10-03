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
 *
 * Only drizzle's tag is audited. postgres-js's own client tag (`const sql = postgres(url)`)
 * serializes Dates correctly, so the tag is resolved to a `drizzle-orm` import binding rather
 * than matched by the identifier name.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import ts from '@typescript/typescript6'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const SCAN_DIRS = [join(ROOT, 'apps'), join(ROOT, 'packages'), join(ROOT, 'scripts')]
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build', 'out'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const ALLOW_ANNOTATION = '// sql-date-bound:'
const DRIZZLE_MODULE = 'drizzle-orm'
const STATEMENT_TYPE = /(Statement|Declaration)$/

function isDrizzleModule(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DRIZZLE_MODULE || value.startsWith(`${DRIZZLE_MODULE}/`))
  )
}

interface Violation {
  file: string
  line: number
  expression: string
  reason: string
}

/** Result of auditing one file; `parseError` marks a file the parser could not read. */
interface FileAnalysis {
  violations: Violation[]
  parseError?: string
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
function isDateExpression(node: unknown, isDateName: (name: string) => boolean): boolean {
  if (!isSyntaxNode(node)) return false
  const current = unwrap(node)
  if (current.type === 'NewExpression')
    return isSyntaxNode(current.callee) && current.callee.name === 'Date'
  if (current.type === 'Identifier')
    return typeof current.name === 'string' && isDateName(current.name)
  if (current.type === 'ConditionalExpression')
    return (
      isDateExpression(current.consequent, isDateName) ||
      isDateExpression(current.alternate, isDateName)
    )
  if (current.type === 'LogicalExpression')
    return isDateExpression(current.left, isDateName) || isDateExpression(current.right, isDateName)
  return false
}

/**
 * Lexical scope for Date-typed bindings; lookups walk the parent chain.
 *
 * `localNames` holds every name the scope binds, Date-typed or not, so a lookup
 * stops at the nearest declaring scope instead of reaching past a shadow.
 */
interface Scope {
  parent: Scope | null
  dateNames: Set<string>
  localNames: Set<string>
}

const createScope = (parent: Scope | null): Scope => ({
  parent,
  dateNames: new Set(),
  localNames: new Set(),
})

/**
 * Resolves `name` to the nearest scope that binds it.
 *
 * `dateNames` is consulted before `localNames` at every level so the resolution
 * fixpoint still converges: a local binding not *yet* proven to be a Date blocks
 * the walk on this pass, and a later pass finds it once proven.
 */
function hasDateName(scope: Scope, name: string): boolean {
  for (let current: Scope | null = scope; current; current = current.parent) {
    if (current.dateNames.has(name)) return true
    if (current.localNames.has(name)) return false
  }
  return false
}

/** Records every identifier a binding pattern introduces, however nested. */
function collectBoundNames(node: unknown, into: Set<string>): void {
  if (!isSyntaxNode(node)) return
  if (node.type === 'Identifier') {
    if (typeof node.name === 'string') into.add(node.name)
    return
  }
  if (node.type === 'ObjectPattern' && Array.isArray(node.properties)) {
    for (const property of node.properties) {
      if (!isSyntaxNode(property)) continue
      collectBoundNames(property.type === 'RestElement' ? property.argument : property.value, into)
    }
    return
  }
  if (node.type === 'ArrayPattern' && Array.isArray(node.elements)) {
    for (const element of node.elements) collectBoundNames(element, into)
    return
  }
  if (node.type === 'AssignmentPattern') collectBoundNames(node.left, into)
  if (node.type === 'RestElement') collectBoundNames(node.argument, into)
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
  'TSDeclareFunction',
])

/** Field names declared `Date` on an interface or object-type alias, keyed by type name. */
function collectDateTypeFields(program: SyntaxNode): Map<string, Set<string>> {
  const fields = new Map<string, Set<string>>()

  const membersOf = (node: unknown): SyntaxNode[] => {
    if (!isSyntaxNode(node)) return []
    if (node.type === 'TSTypeLiteral' && Array.isArray(node.members))
      return node.members.filter(isSyntaxNode)
    if (node.type === 'TSInterfaceBody' && Array.isArray(node.body))
      return node.body.filter(isSyntaxNode)
    return []
  }

  const visit = (node: SyntaxNode) => {
    const name = isSyntaxNode(node.id) ? node.id.name : undefined
    if (typeof name === 'string') {
      const members =
        node.type === 'TSInterfaceDeclaration'
          ? membersOf(node.body)
          : node.type === 'TSTypeAliasDeclaration'
            ? membersOf(node.typeAnnotation)
            : []
      for (const member of members) {
        if (member.type !== 'TSPropertySignature' || !isDateAnnotation(member.typeAnnotation))
          continue
        const key = isSyntaxNode(member.key) ? member.key.name : undefined
        if (typeof key !== 'string') continue
        const existing = fields.get(name)
        if (existing) existing.add(key)
        else fields.set(name, new Set([key]))
      }
    }
    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)
  return fields
}

/** Local names the `sql` tag is reachable through, resolved from `drizzle-orm` imports. */
interface SqlBindings {
  tags: Set<string>
  namespaces: Set<string>
}

function collectSqlBindings(program: SyntaxNode): SqlBindings {
  const bindings: SqlBindings = { tags: new Set(), namespaces: new Set() }

  const visit = (node: SyntaxNode) => {
    if (node.type === 'ImportDeclaration' && isSyntaxNode(node.source)) {
      const source = node.source.value
      if (isDrizzleModule(source) && Array.isArray(node.specifiers)) {
        for (const specifier of node.specifiers) {
          if (!isSyntaxNode(specifier) || !isSyntaxNode(specifier.local)) continue
          const local = specifier.local.name
          if (typeof local !== 'string') continue
          if (specifier.type === 'ImportNamespaceSpecifier') bindings.namespaces.add(local)
          else if (
            specifier.type === 'ImportSpecifier' &&
            isSyntaxNode(specifier.imported) &&
            specifier.imported.name === 'sql'
          )
            bindings.tags.add(local)
        }
      }
    }
    if (node.type === 'VariableDeclarator' && isDrizzleImportCall(node.init))
      bindDynamicImport(node.id, bindings)

    for (const child of getChildNodes(node)) visit(child)
  }
  visit(program)
  return bindings
}

/**
 * `import('drizzle-orm')`, with or without an `await`.
 *
 * Babel parses a dynamic import as a `CallExpression` whose callee is `Import`;
 * the `ImportExpression` spelling is accepted too so a parser upgrade cannot
 * silently reopen the hole this closes.
 */
function isDrizzleImportCall(node: unknown): boolean {
  if (!isSyntaxNode(node)) return false
  const current = node.type === 'AwaitExpression' ? unwrapAwait(node) : node
  if (!isSyntaxNode(current)) return false
  const isImport =
    current.type === 'ImportExpression' ||
    (current.type === 'CallExpression' &&
      isSyntaxNode(current.callee) &&
      current.callee.type === 'Import')
  if (!isImport) return false
  const args = Array.isArray(current.arguments) ? current.arguments : []
  const source = isSyntaxNode(current.source) ? current.source : args.find(isSyntaxNode)
  const value = source?.value
  return isDrizzleModule(value)
}

const unwrapAwait = (node: SyntaxNode): unknown =>
  isSyntaxNode(node.argument) ? node.argument : undefined

/**
 * Binds `const { sql } = await import('drizzle-orm')` and its namespace form.
 *
 * Without this a file importing the tag dynamically resolves no tag at all, so
 * the whole file is skipped rather than audited — a silent hole, not a warning.
 */
function bindDynamicImport(target: unknown, bindings: SqlBindings): void {
  if (!isSyntaxNode(target)) return
  if (target.type === 'Identifier' && typeof target.name === 'string') {
    bindings.namespaces.add(target.name)
    return
  }
  if (target.type !== 'ObjectPattern' || !Array.isArray(target.properties)) return
  for (const property of target.properties) {
    if (!isSyntaxNode(property) || property.type !== 'ObjectProperty') continue
    const key = isSyntaxNode(property.key) ? property.key.name : undefined
    if (key !== 'sql') continue
    const raw = isSyntaxNode(property.value) ? property.value : undefined
    const local = raw?.type === 'AssignmentPattern' && isSyntaxNode(raw.left) ? raw.left : raw
    if (local?.type === 'Identifier' && typeof local.name === 'string')
      bindings.tags.add(local.name)
  }
}

/** `sql`, an aliased import of it, or `namespace.sql`. */
function isSqlReference(node: unknown, bindings: SqlBindings): boolean {
  if (!isSyntaxNode(node)) return false
  const current = unwrap(node)
  if (current.type === 'Identifier')
    return typeof current.name === 'string' && bindings.tags.has(current.name)
  return (
    current.type === 'MemberExpression' &&
    current.computed !== true &&
    isSyntaxNode(current.object) &&
    current.object.type === 'Identifier' &&
    typeof current.object.name === 'string' &&
    bindings.namespaces.has(current.object.name) &&
    isSyntaxNode(current.property) &&
    current.property.name === 'sql'
  )
}

/** Matches `` sql`…` `` and `` sql<T>`…` `` (the generic wraps the tag in TSInstantiationExpression). */
function isSqlTag(node: unknown, bindings: SqlBindings): boolean {
  if (isSqlReference(node, bindings)) return true
  return (
    isSyntaxNode(node) &&
    node.type === 'TSInstantiationExpression' &&
    isSqlReference(node.expression, bindings)
  )
}

function isSqlParamCall(node: SyntaxNode, bindings: SqlBindings): boolean {
  const callee = isSyntaxNode(node.callee) ? unwrap(node.callee) : undefined
  return Boolean(
    callee &&
      callee.type === 'MemberExpression' &&
      isSyntaxNode(callee.property) &&
      callee.property.name === 'param' &&
      isSqlReference(callee.object, bindings)
  )
}

/**
 * A violation is excused only when the line above one of its anchors is a line comment whose
 * text is exactly the documented annotation followed by a non-empty reason. Matching the
 * marker anywhere on the line would let unrelated code — or a bare marker with no
 * justification — silently disable the audit.
 */
function isAllowAnnotation(line: string | undefined): boolean {
  const trimmed = (line ?? '').trim()
  if (!trimmed.startsWith(ALLOW_ANNOTATION)) return false
  return trimmed.slice(ALLOW_ANNOTATION.length).trim().length > 0
}

interface BindingCandidate {
  scope: Scope
  name: string
  annotation?: unknown
  init?: unknown
}

interface CheckSite {
  node: SyntaxNode
  scope: Scope
  /** Lines an allow annotation may sit above: the expression, its template, its statement. */
  anchors: number[]
  reason: string
}

const TEMPLATE_REASON =
  'a Date interpolated into a raw sql template has no encoder; bind it with sql.param(date, table.column)'
const PARAM_REASON = 'sql.param(date) has no encoder; pass the column as the second argument'

function analyzeSource(source: string, file = 'source.ts'): FileAnalysis {
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
    return {
      violations: [],
      parseError: error instanceof Error ? error.message : String(error),
    }
  }

  const bindings = collectSqlBindings(program)
  if (bindings.tags.size === 0 && bindings.namespaces.size === 0) return { violations: [] }

  const dateTypeFields = collectDateTypeFields(program)
  const rootScope: Scope = createScope(null)
  const candidates: BindingCandidate[] = []
  const checks: CheckSite[] = []

  /** Field names typed `Date` on an inline object type or a named interface/type alias. */
  const dateFieldsOf = (annotation: unknown): Set<string> => {
    if (!isSyntaxNode(annotation)) return new Set()
    if (annotation.type === 'TSTypeAnnotation') return dateFieldsOf(annotation.typeAnnotation)
    if (annotation.type === 'TSTypeLiteral' && Array.isArray(annotation.members)) {
      const names = new Set<string>()
      for (const member of annotation.members) {
        if (!isSyntaxNode(member)) continue
        if (member.type !== 'TSPropertySignature' || !isDateAnnotation(member.typeAnnotation))
          continue
        const key = isSyntaxNode(member.key) ? member.key.name : undefined
        if (typeof key === 'string') names.add(key)
      }
      return names
    }
    if (annotation.type === 'TSTypeReference' && isSyntaxNode(annotation.typeName)) {
      const name = annotation.typeName.name
      if (typeof name === 'string') return dateTypeFields.get(name) ?? new Set()
    }
    return new Set()
  }

  /** Binds `{ since }: { since: Date }` — a destructured Date is still an unbound Date. */
  const bindPattern = (pattern: unknown, annotation: unknown, scope: Scope) => {
    if (!isSyntaxNode(pattern) || pattern.type !== 'ObjectPattern') return
    const fields = dateFieldsOf(annotation)
    if (fields.size === 0 || !Array.isArray(pattern.properties)) return
    for (const property of pattern.properties) {
      if (!isSyntaxNode(property) || property.type !== 'ObjectProperty') continue
      const key = isSyntaxNode(property.key) ? property.key.name : undefined
      const raw = isSyntaxNode(property.value) ? property.value : undefined
      const value = raw?.type === 'AssignmentPattern' && isSyntaxNode(raw.left) ? raw.left : raw
      if (typeof key !== 'string' || !fields.has(key)) continue
      if (value?.type === 'Identifier' && typeof value.name === 'string')
        scope.dateNames.add(value.name)
    }
  }

  const bindParameters = (fn: SyntaxNode, scope: Scope) => {
    if (!Array.isArray(fn.params)) return
    for (const raw of fn.params) {
      if (!isSyntaxNode(raw)) continue
      const param = raw.type === 'AssignmentPattern' && isSyntaxNode(raw.left) ? raw.left : raw
      collectBoundNames(param, scope.localNames)
      if (param.type === 'Identifier' && typeof param.name === 'string') {
        if (isDateAnnotation(param.typeAnnotation)) scope.dateNames.add(param.name)
      } else if (param.type === 'ObjectPattern') {
        bindPattern(param, param.typeAnnotation, scope)
      }
    }
  }

  const lines = source.split('\n')

  const visit = (node: SyntaxNode, parentScope: Scope, parentStatementLine: number) => {
    let scope = parentScope
    if (FUNCTION_TYPES.has(node.type)) {
      scope = createScope(parentScope)
      bindParameters(node, scope)
    }
    const statementLine =
      STATEMENT_TYPE.test(node.type) && node.loc ? node.loc.start.line : parentStatementLine

    if (node.type === 'VariableDeclarator' && isSyntaxNode(node.id)) {
      const target = node.id
      collectBoundNames(target, scope.localNames)
      if (target.type === 'Identifier' && typeof target.name === 'string') {
        candidates.push({
          scope,
          name: target.name,
          annotation: target.typeAnnotation ?? node.typeAnnotation,
          init: node.init,
        })
      } else if (target.type === 'ObjectPattern') {
        bindPattern(target, target.typeAnnotation, scope)
      }
    }

    if (node.type === 'TaggedTemplateExpression' && isSqlTag(node.tag, bindings)) {
      const quasi = isSyntaxNode(node.quasi) ? node.quasi : undefined
      const expressions = Array.isArray(quasi?.expressions) ? quasi.expressions : []
      const tagLine = node.loc?.start.line
      for (const expression of expressions) {
        if (!isSyntaxNode(expression) || !expression.loc) continue
        checks.push({
          node: expression,
          scope,
          anchors: [expression.loc.start.line, tagLine ?? statementLine, statementLine],
          reason: TEMPLATE_REASON,
        })
      }
    }

    if (node.type === 'CallExpression' && isSqlParamCall(node, bindings)) {
      const args = Array.isArray(node.arguments) ? node.arguments : []
      const argument = args.length === 1 && isSyntaxNode(args[0]) ? args[0] : undefined
      if (argument?.loc) {
        checks.push({
          node: argument,
          scope,
          anchors: [argument.loc.start.line, node.loc?.start.line ?? statementLine, statementLine],
          reason: PARAM_REASON,
        })
      }
    }

    for (const child of getChildNodes(node)) visit(child, scope, statementLine)
  }
  visit(program, rootScope, 1)

  /** Re-run until stable so `const b = a` chains resolve regardless of declaration order. */
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of candidates) {
      if (hasDateName(candidate.scope, candidate.name)) continue
      const isDate =
        isDateAnnotation(candidate.annotation) ||
        isDateExpression(candidate.init, (name) => hasDateName(candidate.scope, name))
      if (isDate) {
        candidate.scope.dateNames.add(candidate.name)
        changed = true
      }
    }
  }

  const violations: Violation[] = []
  for (const check of checks) {
    const { node } = check
    if (typeof node.start !== 'number' || typeof node.end !== 'number' || !node.loc) continue
    if (!isDateExpression(node, (name) => hasDateName(check.scope, name))) continue
    if (check.anchors.some((line) => isAllowAnnotation(lines[line - 2]))) continue
    violations.push({
      file,
      line: node.loc.start.line,
      expression: source.slice(node.start, node.end),
      reason: check.reason,
    })
  }

  return { violations }
}

/**
 * Skips the parse for files that cannot bind the tag.
 *
 * `collectSqlBindings` and `isDrizzleImportCall` both match the specifier as a string literal,
 * so a source that never names the module yields no bindings and no violations. The scanner
 * decodes escaped string tokens before comparing them and also requires a possible `sql` binding.
 */
export function mayBindDrizzleSql(source: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, source)
  let hasDrizzleModule = false
  let hasSqlToken = false

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const value = scanner.getTokenValue()
    if (
      (token === ts.SyntaxKind.StringLiteral ||
        token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) &&
      isDrizzleModule(value)
    ) {
      hasDrizzleModule = true
    }
    if (
      (token === ts.SyntaxKind.Identifier || token === ts.SyntaxKind.StringLiteral) &&
      value === 'sql'
    ) {
      hasSqlToken = true
    }
    if (hasDrizzleModule && hasSqlToken) return true
  }
  return false
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
  const violations: Violation[] = []
  const skipped: { file: string; parseError: string }[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (!mayBindDrizzleSql(source)) continue
    const analysis = analyzeSource(source, file)
    if (analysis.parseError) skipped.push({ file, parseError: analysis.parseError })
    violations.push(...analysis.violations)
  }

  if (skipped.length > 0) {
    console.warn(`⚠ ${skipped.length} file(s) could not be parsed and were not audited:`)
    for (const entry of skipped)
      console.warn(`  ${relative(ROOT, entry.file)}  ${entry.parseError}`)
  }

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
        `\n${ALLOW_ANNOTATION} <reason> on the line above the expression, its sql template, or` +
        `\nits enclosing statement.`
    )
    process.exit(1)
  }

  console.log(`✓ ${files.length} files bind every sql-template Date through a column encoder`)
}

if (import.meta.main) main()
