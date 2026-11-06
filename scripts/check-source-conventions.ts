#!/usr/bin/env bun
/**
 * Ratchets written source conventions that no other check enforces, file by file, so an agent
 * copying a nearby violation gets a failing check instead of a precedent.
 *
 * - `relative-import` (`.claude/rules/sim-imports.md`): an `apps/sim` module imports, re-exports,
 *   dynamically imports or `require`s a relative path. The one exception is a barrel `index.ts(x)`
 *   re-exporting from inside its own folder, written either as `export { X } from './x'` or as an
 *   import whose every binding the barrel then exports (`export { X }`, or renamed with
 *   `export const Y = X`). A path that leaves the folder (`../x`,
 *   `./../x`), a side-effect import, and an import the barrel keeps for itself are all flagged.
 *   A verbatim Mothership contract copy in `lib/mothership/generated/` is exempt: its imports mirror
 *   the worker source it is synced from, so it cannot use the app's aliases.
 * - `text-size-literal` (`.claude/rules/sim-styling.md` "Tailwind" 3): an `apps/sim` string or
 *   template literal sets type size with `text-[Npx]` where the documented text scale has a token
 *   for that size (`text-[13px]` → `text-small`). The literal also drops the token's line-height.
 *   Sizes the scale does not cover (display headings such as `text-[32px]`) are a design-system
 *   gap, not a rename, so they are not counted. Comments are not code and are not counted.
 * - `static-inline-style` (`sim-styling.md` "Tailwind" 1): a JSX `style={{ … }}` whose every
 *   property is a literal that is not a CSS variable, so the whole object could be classes. A
 *   style with any dynamic value, spread, computed key or custom property is left alone, and so is
 *   a file that renders without the Tailwind stylesheet (react-email templates, `next/og` images).
 * - `api-db-import` (CLAUDE.md "Application Operation Boundary"): a module under `app/api/`
 *   imports a value from `@sim/db`. Surface adapters never query protected data; the query belongs
 *   in an application use case or manager. Type-only imports are allowed.
 * - `bare-route-handler` (CLAUDE.md "API Contracts and Routes"): an `app/api/**` `route.ts` HTTP
 *   verb export is a handler body written in the route file — a function declaration, a function
 *   expression, an async or block-bodied arrow, or an expression arrow that does not delegate to a
 *   wrapped handler — directly or through a local alias. Allowed: the result of a call (a route
 *   builder, `withRouteHandler`, or a factory that composes them in another module), an alias or
 *   member of such a result, and a synchronous expression arrow that delegates to one, such as
 *   `(req, ctx) => withSpan(…, () => handler(req, ctx))`. Whether a factory in another module
 *   applies `withRouteHandler` is that module's concern; this rule only sees the route file.
 *
 * Existing hits are counted per rule and file in `scripts/check-source-conventions.baseline.json`.
 * A file whose count rises, or that gains its first hit, fails. A count that drops also fails until
 * the baseline is rewritten, so the baseline only shrinks and a fix cannot be spent on a new hit in
 * the same file. Regenerate after removing hits: `bun run scripts/check-source-conventions.ts --update`.
 * A rule added to this file later is admitted once with `--update --init-rule <rule>`, which only
 * works while the baseline has no entry for that rule at all.
 *
 * Run: `bun run check:source-conventions`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts/check-source-conventions.baseline.json')

const RULES = [
  'relative-import',
  'text-size-literal',
  'static-inline-style',
  'api-db-import',
  'bare-route-handler',
] as const

export type Rule = (typeof RULES)[number]
type Counts = Record<string, number>
export type Baseline = Partial<Record<Rule, Counts>>
export type CurrentCounts = Record<Rule, Counts>

interface Violation {
  rule: Rule
  file: string
  line: number
  detail: string
}

export interface CountChange {
  rule: Rule
  file: string
  count: number
  allowed: number
}

const HOW_TO_FIX: Record<Rule, string> = {
  'relative-import':
    'Import by absolute path (`@/…` or the `@sim/*` package); only a barrel index.ts may re-export its own folder relatively (.claude/rules/sim-imports.md).',
  'text-size-literal':
    'Replace the literal with the token named on each line; type size is always a named token (.claude/rules/sim-styling.md "Text Scale").',
  'static-inline-style':
    'Every value in this style object is static: replace it with Tailwind classes (on an SVG element, its presentation attribute, e.g. `stopColor=`). Inline `style` is only for a genuinely dynamic value or a CSS variable (.claude/rules/sim-styling.md "Tailwind" 1).',
  'api-db-import':
    'Move the query into an application use case or manager and call it from the route; surface adapters never query protected data (CLAUDE.md "Application Operation Boundary"). Type-only imports are fine.',
  'bare-route-handler':
    'Export the verb as the result of a shared route builder (`defineInternalJsonRoute`, `defineV2JsonRoute`, …) or `withRouteHandler`, never a bare handler function (CLAUDE.md "API Contracts and Routes").',
}

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
/** A type-size arbitrary value, alone or behind variants (`md:`, `!`). Colors and vars don't match. */
const TEXT_SIZE_LITERAL = /(?:^|[\s'"`:!{(])text-\[(\d+(?:\.\d+)?)px\]/g
/** The documented scale (`sim-styling.md` "Text Scale"), from the `@theme` block in globals.css. */
const TEXT_SIZE_TOKENS: Record<string, string> = {
  '10': 'text-micro',
  '11': 'text-xs',
  '12': 'text-caption',
  '13': 'text-small',
  '14': 'text-sm',
  '15': 'text-base',
  '16': 'text-md',
  '18': 'text-lg',
}
/** Imports that mean the file renders without the app stylesheet, so inline style is the only option. */
const NO_TAILWIND_RENDERERS = /^(?:@react-email\/|next\/og$)/
/** Wrappers that leave the wrapped expression's value unchanged. */
const TRANSPARENT_WRAPPERS = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
])

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown }

function walk(node: unknown, visit: (node: Node) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const current = node as Node
  if (typeof current.type === 'string') visit(current)
  for (const [key, value] of Object.entries(current)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    walk(value, visit)
  }
}

function parseSource(file: string, source: string): Node {
  try {
    return parse(source, {
      sourceType: 'module',
      plugins: [
        'typescript',
        ...(file.endsWith('x') ? (['jsx'] as const) : []),
        'topLevelAwait',
        'decorators',
      ],
      errorRecovery: true,
    }).program as unknown as Node
  } catch (error) {
    throw new Error(`${file}: cannot parse, so its conventions cannot be counted: ${error}`)
  }
}

function lineOf(node: Node): number {
  return node.loc?.start.line ?? 0
}

function unwrap(node: Node | undefined): Node | undefined {
  let current = node
  while (current && TRANSPARENT_WRAPPERS.has(current.type)) current = current.expression as Node
  return current
}

function stringValue(node: unknown): string | undefined {
  const candidate = node as Node | undefined
  if (candidate?.type === 'StringLiteral') return candidate.value as string
  if (candidate?.type === 'TemplateLiteral' && (candidate.expressions as unknown[]).length === 0) {
    return ((candidate.quasis as Node[])[0].value as { cooked: string }).cooked
  }
  return undefined
}

function isRelative(specifier: string | undefined): specifier is string {
  return specifier !== undefined && (specifier.startsWith('./') || specifier.startsWith('../'))
}

/** `./x` and `./a/b` stay inside the importing file's folder; `../x` and `./../x` leave it. */
function staysInFolder(specifier: string): boolean {
  const normalized = path.posix.normalize(specifier)
  return normalized !== '..' && !normalized.startsWith('../')
}

function isBarrel(file: string): boolean {
  return /(?:^|\/)index\.tsx?$/.test(file)
}

/** The specifier of `import('x')` or `require('x')`, in either AST shape Babel produces. */
function dynamicSpecifier(node: Node): string | undefined {
  if (node.type === 'ImportExpression') return stringValue(node.source)
  if (node.type !== 'CallExpression') return undefined
  const callee = node.callee as Node
  const isImportOrRequire =
    callee.type === 'Import' || (callee.type === 'Identifier' && callee.name === 'require')
  return isImportOrRequire ? stringValue((node.arguments as Node[])[0]) : undefined
}

/** The specifier of a static `import`, `import x = require()`, or `export … from`. */
function declarationSpecifier(node: Node): string | undefined {
  if (node.type === 'TSImportEqualsDeclaration') {
    return stringValue((node.moduleReference as Node | undefined)?.expression)
  }
  const isModuleDeclaration =
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportAllDeclaration'
  return isModuleDeclaration ? stringValue(node.source) : undefined
}

/**
 * Local names a module passes straight through: `export { a, b as c }`, `export default a`, and the
 * renaming alias `export const c = a`.
 */
function exportedLocals(program: Node): Set<string> {
  const names = new Set<string>()
  for (const statement of program.body as Node[]) {
    if (statement.type === 'ExportNamedDeclaration' && !statement.source) {
      for (const specifier of (statement.specifiers as Node[] | undefined) ?? []) {
        const local = specifier.local as Node | undefined
        if (local?.type === 'Identifier') names.add(local.name as string)
      }
      const declaration = statement.declaration as Node | null
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations as Node[]) {
          const init = unwrap(declarator.init as Node | undefined)
          if (init?.type === 'Identifier') names.add(init.name as string)
        }
      }
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration as Node
      if (declaration.type === 'Identifier') names.add(declaration.name as string)
    }
  }
  return names
}

/** A barrel line that only passes a sibling module through: the one allowed relative form. */
function isBarrelReExport(node: Node, specifier: string, reExported: Set<string>): boolean {
  if (!staysInFolder(specifier)) return false
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') return true
  if (node.type !== 'ImportDeclaration') return false
  const specifiers = node.specifiers as Node[]
  return (
    specifiers.length > 0 &&
    specifiers.every((imported) => reExported.has((imported.local as Node).name as string))
  )
}

/** The specifier of a type-position `import('./x').T`. */
function importTypeSpecifier(node: Node): string | undefined {
  if (node.type !== 'TSImportType') return undefined
  const argument = node.argument as Node
  return stringValue(argument.type === 'TSLiteralType' ? argument.literal : argument)
}

function findRelativeImports(file: string, program: Node): Violation[] {
  const violations: Violation[] = []
  const reExported = isBarrel(file) ? exportedLocals(program) : undefined
  walk(program, (node) => {
    const declared = declarationSpecifier(node)
    const specifier = declared ?? dynamicSpecifier(node) ?? importTypeSpecifier(node)
    if (!isRelative(specifier)) return
    if (reExported && isBarrelReExport(node, specifier, reExported)) return
    violations.push({ rule: 'relative-import', file, line: lineOf(node), detail: specifier })
  })
  return violations
}

/** Every string and template chunk in the file with its first line; comments are not included. */
function stringChunks(program: Node): Array<{ text: string; line: number }> {
  const chunks: Array<{ text: string; line: number }> = []
  walk(program, (node) => {
    if (node.type === 'StringLiteral') {
      chunks.push({ text: node.value as string, line: lineOf(node) })
    } else if (node.type === 'TemplateElement') {
      chunks.push({ text: (node.value as { raw: string }).raw, line: lineOf(node) })
    }
  })
  return chunks
}

function findTextSizeLiterals(file: string, program: Node): Violation[] {
  const violations: Violation[] = []
  for (const { text, line } of stringChunks(program)) {
    for (const match of text.matchAll(TEXT_SIZE_LITERAL)) {
      const size = String(Number(match[1]))
      const token = TEXT_SIZE_TOKENS[size]
      if (!token) continue
      const linesBefore = text.slice(0, match.index).split('\n').length - 1
      violations.push({
        rule: 'text-size-literal',
        file,
        line: line + linesBefore,
        detail: `text-[${match[1]}px] → ${token}`,
      })
    }
  }
  return violations
}

/** A value that is the same on every render and is not a CSS variable reference. */
function isStaticNonVariableValue(node: Node): boolean {
  if (node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return true
  if (
    node.type === 'UnaryExpression' &&
    node.operator === '-' &&
    (node.argument as Node).type === 'NumericLiteral'
  ) {
    return true
  }
  const text = stringValue(node)
  return text !== undefined && !text.includes('var(')
}

function propertyKeyName(property: Node): string | undefined {
  if (property.computed) return undefined
  const key = property.key as Node
  if (key.type === 'Identifier') return key.name as string
  return stringValue(key)
}

function isFullyStaticStyle(object: Node): boolean {
  const properties = object.properties as Node[]
  if (properties.length === 0) return false
  return properties.every((property) => {
    if (property.type !== 'ObjectProperty') return false
    const name = propertyKeyName(property)
    if (name === undefined || name.startsWith('--')) return false
    const value = unwrap(property.value as Node)
    return value !== undefined && isStaticNonVariableValue(value)
  })
}

function findStaticInlineStyles(file: string, program: Node): Violation[] {
  const rendersWithoutTailwind = (program.body as Node[]).some(
    (statement) =>
      statement.type === 'ImportDeclaration' &&
      NO_TAILWIND_RENDERERS.test(stringValue(statement.source) ?? '')
  )
  if (rendersWithoutTailwind) return []
  const violations: Violation[] = []
  walk(program, (node) => {
    if (node.type !== 'JSXAttribute') return
    const name = node.name as Node
    if (name.type !== 'JSXIdentifier' || name.name !== 'style') return
    const value = node.value as Node | null
    if (value?.type !== 'JSXExpressionContainer') return
    const expression = unwrap(value.expression as Node)
    if (expression?.type === 'ObjectExpression' && isFullyStaticStyle(expression)) {
      violations.push({ rule: 'static-inline-style', file, line: lineOf(node), detail: 'style' })
    }
  })
  return violations
}

function isDbModule(specifier: string | undefined): specifier is string {
  return specifier === '@sim/db' || (specifier?.startsWith('@sim/db/') ?? false)
}

function isTypeOnlyDeclaration(node: Node): boolean {
  if (node.importKind === 'type' || node.exportKind === 'type') return true
  const specifiers = (node.specifiers as Node[] | undefined) ?? []
  return (
    specifiers.length > 0 &&
    specifiers.every(
      (specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type'
    )
  )
}

function findApiDbImports(file: string, program: Node): Violation[] {
  const violations: Violation[] = []
  walk(program, (node) => {
    const declared = declarationSpecifier(node)
    const specifier = declared ?? dynamicSpecifier(node)
    if (!isDbModule(specifier)) return
    if (declared !== undefined && isTypeOnlyDeclaration(node)) return
    violations.push({ rule: 'api-db-import', file, line: lineOf(node), detail: specifier })
  })
  return violations
}

/** Top-level function declarations and `const`/`let` declarators by name. */
function topLevelBindings(program: Node): Map<string, Node> {
  const bindings = new Map<string, Node>()
  for (const statement of program.body as Node[]) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? (statement.declaration as Node | null)
        : statement
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      bindings.set((declaration.id as Node).name as string, declaration)
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations as Node[]) {
        const id = declarator.id as Node
        if (id.type === 'Identifier') bindings.set(id.name as string, declarator)
      }
    }
  }
  return bindings
}

/**
 * Classifies a route verb's value. A handler is `wrapped` when it is the result of a call, or an
 * alias or member of one; `bare` when it is a function written in this file (directly or through
 * an alias); `opaque` when it comes from outside the file (an import), which this rule cannot see.
 */
function classifyHandler(
  value: Node | undefined,
  bindings: Map<string, Node>,
  seen: Set<string> = new Set()
): 'wrapped' | 'bare' | 'opaque' {
  const node = unwrap(value)
  if (!node) return 'opaque'
  switch (node.type) {
    case 'CallExpression':
      return 'wrapped'
    case 'FunctionExpression':
      return 'bare'
    case 'ArrowFunctionExpression':
      if (node.async || (node.body as Node).type === 'BlockStatement') return 'bare'
      return delegatesToWrapped(node.body as Node, bindings, seen) ? 'wrapped' : 'bare'
    case 'ConditionalExpression': {
      const branches = [node.consequent, node.alternate].map((branch) =>
        classifyHandler(branch as Node, bindings, new Set(seen))
      )
      return branches.includes('bare')
        ? 'bare'
        : branches.includes('wrapped')
          ? 'wrapped'
          : 'opaque'
    }
    case 'MemberExpression': {
      const member = objectLiteralMember(node, bindings)
      if (member === undefined) return classifyHandler(node.object as Node, bindings, seen)
      if (member === 'unknown' || member.type === 'ObjectMethod') return 'bare'
      return classifyHandler(member.value as Node, bindings, seen)
    }
    case 'Identifier': {
      const name = node.name as string
      const binding = bindings.get(name)
      if (!binding || seen.has(name)) return 'opaque'
      seen.add(name)
      if (binding.type === 'FunctionDeclaration') return 'bare'
      return classifyHandler(binding.init as Node | undefined, bindings, seen)
    }
    default:
      return 'bare'
  }
}

/**
 * The property `handlers.GET` selects when `handlers` is a local object literal, so the selected
 * value is classified rather than the object. Later entries win, as they do at runtime; a spread
 * or computed key after the last match (or with no match) could supply the value, so the member is
 * `unknown` and cannot be shown to be wrapped. Undefined when the object is not a local literal.
 */
function objectLiteralMember(
  member: Node,
  bindings: Map<string, Node>
): Node | 'unknown' | undefined {
  const object = unwrap(member.object as Node)
  const property = member.property as Node
  if (object?.type !== 'Identifier' || member.computed || property.type !== 'Identifier') {
    return undefined
  }
  const binding = bindings.get(object.name as string)
  const literal = binding?.type === 'VariableDeclarator' ? unwrap(binding.init as Node) : undefined
  if (literal?.type !== 'ObjectExpression') return undefined
  let selected: Node | 'unknown' = 'unknown'
  for (const entry of literal.properties as Node[]) {
    const name = entry.type === 'SpreadElement' ? undefined : propertyKeyName(entry)
    if (name === undefined) selected = 'unknown'
    else if (name === property.name) selected = entry
  }
  return selected
}

/** Whether an arrow's expression body calls through a local binding that is a wrapped handler. */
function delegatesToWrapped(body: Node, bindings: Map<string, Node>, seen: Set<string>): boolean {
  let delegates = false
  walk(body, (node) => {
    if (delegates || node.type !== 'Identifier') return
    const name = node.name as string
    const binding = bindings.get(name)
    if (binding?.type !== 'VariableDeclarator' || seen.has(name)) return
    delegates =
      classifyHandler(binding.init as Node | undefined, bindings, new Set([...seen, name])) ===
      'wrapped'
  })
  return delegates
}

function findBareRouteHandlers(file: string, program: Node): Violation[] {
  const violations: Violation[] = []
  const bindings = topLevelBindings(program)
  const report = (node: Node, verb: string) =>
    violations.push({ rule: 'bare-route-handler', file, line: lineOf(node), detail: verb })

  for (const statement of program.body as Node[]) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.source) continue
    const declaration = statement.declaration as Node | null
    if (declaration?.type === 'FunctionDeclaration') {
      const verb = (declaration.id as Node | undefined)?.name as string | undefined
      if (verb && HTTP_VERBS.has(verb)) report(statement, verb)
      continue
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations as Node[]) {
        const id = declarator.id as Node
        if (id.type !== 'Identifier' || !HTTP_VERBS.has(id.name as string)) continue
        if (classifyHandler(declarator.init as Node | undefined, bindings) === 'bare') {
          report(statement, id.name as string)
        }
      }
      continue
    }
    for (const specifier of (statement.specifiers as Node[] | undefined) ?? []) {
      const exported = specifier.exported as Node
      const verb =
        exported.type === 'Identifier' ? (exported.name as string) : stringValue(exported)
      if (!verb || !HTTP_VERBS.has(verb)) continue
      if (classifyHandler(specifier.local as Node, bindings) === 'bare') report(statement, verb)
    }
  }
  return violations
}

const CONTRACT_COPY_DIR = 'apps/sim/lib/mothership/generated/'
const CONTRACT_COPY_HEADER =
  '// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/'

/** A file `contracts:sync` copies byte for byte from the Mothership worker. */
function isContractCopy(file: string, source: string): boolean {
  return file.startsWith(CONTRACT_COPY_DIR) && source.startsWith(CONTRACT_COPY_HEADER)
}

/** Unit, integration and live tests, plus fixtures: they bind real boundaries on purpose. */
function isTestFile(file: string): boolean {
  return /\.(?:test|spec|integration)\.tsx?$/.test(file) || file.includes('/__fixtures__/')
}

/** Every convention violation in one file; `file` is repo-relative with forward slashes. */
export function findViolations(file: string, source: string): Violation[] {
  if (!file.startsWith('apps/sim/') || !/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return []
  const test = isTestFile(file)
  const isApi = file.startsWith('apps/sim/app/api/') && !test
  // Cheap textual gates; each is a superset of what its rule can match, and the AST decides.
  const wantsRelative = !isContractCopy(file, source) && /['"`]\.\.?\//.test(source)
  const wantsTextSize = !test && /text-\[\d/.test(source)
  const wantsStyle = !test && file.endsWith('.tsx') && /\bstyle\s*=\s*\{/.test(source)
  const wantsDb = isApi && source.includes('@sim/db')
  const wantsRoute = isApi && /(?:^|\/)route\.ts$/.test(file)
  if (!(wantsRelative || wantsTextSize || wantsStyle || wantsDb || wantsRoute)) return []

  const program = parseSource(file, source)
  return [
    ...(wantsRelative ? findRelativeImports(file, program) : []),
    ...(wantsTextSize ? findTextSizeLiterals(file, program) : []),
    ...(wantsStyle ? findStaticInlineStyles(file, program) : []),
    ...(wantsDb ? findApiDbImports(file, program) : []),
    ...(wantsRoute ? findBareRouteHandlers(file, program) : []),
  ]
}

/** Files whose count rose past the baseline, and baselined files whose count fell below it. */
export function compareToBaseline(
  baseline: Baseline,
  current: CurrentCounts
): { raised: CountChange[]; dropped: CountChange[] } {
  const raised: CountChange[] = []
  const dropped: CountChange[] = []
  for (const rule of RULES) {
    const before = baseline[rule] ?? {}
    const after = current[rule]
    for (const [file, count] of Object.entries(after)) {
      const allowed = before[file] ?? 0
      if (count > allowed) raised.push({ rule, file, count, allowed })
    }
    for (const [file, allowed] of Object.entries(before)) {
      const count = after[file] ?? 0
      if (count < allowed) dropped.push({ rule, file, count, allowed })
    }
  }
  return { raised, dropped }
}

/**
 * The baseline `--update` writes: every tracked rule shrunk to the current counts, never raised.
 * `initRule` admits the current hits of a rule the baseline has never tracked, and nothing else.
 */
export function nextBaseline(
  baseline: Baseline,
  current: CurrentCounts,
  initRule?: string
): { baseline: Baseline } | { errors: string[] } {
  if (initRule !== undefined) {
    if (!(RULES as readonly string[]).includes(initRule)) {
      return {
        errors: [`--init-rule ${initRule}: not a rule in this script (${RULES.join(', ')})`],
      }
    }
    if (baseline[initRule as Rule] !== undefined) {
      return {
        errors: [
          `--init-rule ${initRule}: the baseline already tracks this rule, so its debt can only shrink. Fix the new hits instead.`,
        ],
      }
    }
  }
  const errors: string[] = []
  const next: Baseline = {}
  for (const rule of RULES) {
    const before = rule === initRule ? current[rule] : baseline[rule]
    if (before === undefined) {
      if (Object.keys(current[rule]).length) {
        errors.push(
          `${rule} is not in the baseline. Admit its existing hits once with --update --init-rule ${rule}.`
        )
      }
      next[rule] = {}
      continue
    }
    const kept: Counts = {}
    for (const file of Object.keys(current[rule]).sort()) {
      const count = current[rule][file]
      const allowed = before[file] ?? 0
      if (count > allowed) {
        errors.push(
          `refused to raise ${rule} ${file}: ${count} (baseline ${allowed}); fix it instead`
        )
      }
      if (Math.min(count, allowed) > 0) kept[file] = Math.min(count, allowed)
    }
    next[rule] = kept
  }
  return errors.length ? { errors } : { baseline: next }
}

/** Tracked and untracked-but-not-ignored sources, so a new file is checked before it is staged. */
function sourceFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'apps/sim'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  return [...new Set(output.split('\0'))]
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .sort()
}

function collect(): { counts: CurrentCounts; violations: Violation[] } {
  const counts = Object.fromEntries(RULES.map((rule) => [rule, {}])) as CurrentCounts
  const violations: Violation[] = []
  for (const file of sourceFiles()) {
    for (const violation of findViolations(file, readFileSync(path.join(ROOT, file), 'utf8'))) {
      violations.push(violation)
      counts[violation.rule][file] = (counts[violation.rule][file] ?? 0) + 1
    }
  }
  return { counts, violations }
}

function total(counts: Counts | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0)
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/**
 * The committed baseline. A missing file fails closed: restore it from git. `--update --init` is
 * the only way to create one, and it accepts every current hit.
 */
function readBaseline(current: CurrentCounts): Baseline {
  if (existsSync(BASELINE)) return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
  if (process.argv.includes('--update') && process.argv.includes('--init')) return current
  console.error(
    `✗ ${path.relative(ROOT, BASELINE)} is missing. Restore it from git; ` +
      'create a new one only with --update --init.'
  )
  process.exit(1)
}

function main(): void {
  const { counts: current, violations } = collect()
  const baseline = readBaseline(current)

  if (process.argv.includes('--update')) {
    const result = nextBaseline(baseline, current, argValue('--init-rule'))
    if ('errors' in result) {
      for (const error of result.errors) console.error(`✗ ${error}`)
      process.exit(1)
    }
    writeFileSync(BASELINE, `${JSON.stringify(result.baseline, null, 2)}\n`)
    console.log(
      `Wrote ${path.relative(ROOT, BASELINE)}: ` +
        RULES.map((rule) => `${rule} ${total(result.baseline[rule])}`).join(', ')
    )
    process.exit(0)
  }

  const { raised, dropped } = compareToBaseline(baseline, current)
  for (const rule of RULES) {
    const raisedHere = raised.filter((change) => change.rule === rule)
    if (raisedHere.length) {
      console.error(`✗ ${rule}: ${raisedHere.length} file(s) gained hits`)
      for (const { file, count, allowed } of raisedHere) {
        console.error(`  ${file}: ${count} (baseline ${allowed})`)
        for (const violation of violations) {
          if (violation.rule === rule && violation.file === file) {
            console.error(`    ${file}:${violation.line} ${violation.detail}`)
          }
        }
      }
      console.error(`  ${HOW_TO_FIX[rule]}\n`)
    }
    const droppedHere = dropped.filter((change) => change.rule === rule)
    if (droppedHere.length) {
      console.error(`✗ ${rule}: ${droppedHere.length} file(s) dropped below the baseline`)
      for (const { file, count, allowed } of droppedHere) {
        console.error(`  ${file}: ${count} (baseline ${allowed})`)
      }
    }
  }

  if (raised.length || dropped.length) {
    if (dropped.length) {
      console.error(
        '\nCounts dropped — shrink the baseline so they cannot creep back: ' +
          'bun run scripts/check-source-conventions.ts --update'
      )
    }
    if (raised.length) console.error('\nNever raise the baseline to make a new hit pass.')
    if (raised.length && dropped.some((change) => change.count === 0)) {
      console.error(
        'If a regressed file is a baselined file you only moved (git mv), move its entry to the ' +
          `new path in ${path.relative(ROOT, BASELINE)}; its count may not grow.`
      )
    }
    process.exit(1)
  }

  console.log(
    `✓ source conventions (${RULES.map((rule) => `${rule} ${total(current[rule])}`).join(', ')} baselined)`
  )
}

if (import.meta.main) main()
