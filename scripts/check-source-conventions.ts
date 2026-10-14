#!/usr/bin/env bun
/**
 * Ratchets written source conventions that no other check enforces, file by file, so an agent
 * copying a nearby violation gets a failing check instead of a precedent.
 *
 * - `relative-import` (`.claude/rules/sim-imports.md`): an `apps/sim` module imports, re-exports,
 *   dynamically imports or `require`s a relative path. The one exception is a barrel `index.ts(x)`
 *   re-exporting from inside its own folder, written either as `export { X } from './x'` or as an
 *   import followed by `export { X }`; a barrel reaching out with `../` is still flagged.
 * - `text-size-literal` (`.claude/rules/sim-styling.md` "Tailwind" 3): an `apps/sim` class string
 *   sets type size with `text-[Npx]` where the documented text scale has a token for that size
 *   (`text-[13px]` → `text-small`). The literal also drops the token's line-height. Sizes the
 *   scale does not cover (display headings such as `text-[32px]`) are a design-system gap, not a
 *   rename, so they are not counted.
 * - `static-inline-style` (`sim-styling.md` "Tailwind" 1): a JSX `style={{ … }}` whose every
 *   property is a literal that is not a CSS variable, so the whole object could be classes. A
 *   style with any dynamic value, spread, computed key or custom property is left alone, and so is
 *   a file that renders without the Tailwind stylesheet (react-email templates, `next/og` images).
 * - `api-db-import` (CLAUDE.md "Application Operation Boundary"): a module under `app/api/`
 *   imports a value from `@sim/db`. Surface adapters never query protected data; the query belongs
 *   in an application use case or manager. Type-only imports are allowed.
 * - `bare-route-handler` (CLAUDE.md "API Contracts and Routes"): a `route.ts` HTTP verb export is
 *   itself a handler body (a function declaration, an async function, or a function with a block
 *   body) instead of the result of `withRouteHandler` or a route builder. A synchronous one-call
 *   delegate such as `(req, ctx) => withSpan(…, () => handler(req, ctx))` is allowed.
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
type Baseline = Partial<Record<Rule, Counts>>

interface Violation {
  rule: Rule
  file: string
  line: number
  detail: string
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
const NO_TAILWIND_RENDERERS = /from\s+['"](?:@react-email\/[^'"]+|next\/og)['"]/

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

function findRelativeImports(file: string, program: Node): Violation[] {
  const violations: Violation[] = []
  const barrel = isBarrel(file)
  walk(program, (node) => {
    const declared = declarationSpecifier(node)
    const specifier = declared ?? dynamicSpecifier(node)
    if (!isRelative(specifier)) return
    if (declared !== undefined && barrel && specifier.startsWith('./')) return
    violations.push({ rule: 'relative-import', file, line: lineOf(node), detail: specifier })
  })
  return violations
}

function findTextSizeLiterals(file: string, source: string): Violation[] {
  const violations: Violation[] = []
  const lines = source.split('\n')
  lines.forEach((text, index) => {
    for (const match of text.matchAll(TEXT_SIZE_LITERAL)) {
      const token = TEXT_SIZE_TOKENS[match[1]]
      if (!token) continue
      violations.push({
        rule: 'text-size-literal',
        file,
        line: index + 1,
        detail: `text-[${match[1]}px] → ${token}`,
      })
    }
  })
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
    return isStaticNonVariableValue(property.value as Node)
  })
}

function findStaticInlineStyles(file: string, source: string, program: Node): Violation[] {
  if (NO_TAILWIND_RENDERERS.test(source)) return []
  const violations: Violation[] = []
  walk(program, (node) => {
    if (node.type !== 'JSXAttribute') return
    const name = node.name as Node
    if (name.type !== 'JSXIdentifier' || name.name !== 'style') return
    const value = node.value as Node | null
    if (value?.type !== 'JSXExpressionContainer') return
    const expression = value.expression as Node
    if (expression.type === 'ObjectExpression' && isFullyStaticStyle(expression)) {
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

/** A function value that implements a handler itself rather than delegating in one call. */
function isHandlerBody(node: Node | undefined): boolean {
  if (!node) return false
  if (node.type === 'FunctionExpression') return true
  if (node.type === 'ArrowFunctionExpression') {
    return Boolean(node.async) || (node.body as Node).type === 'BlockStatement'
  }
  return false
}

function findBareRouteHandlers(file: string, program: Node): Violation[] {
  const violations: Violation[] = []
  const body = program.body as Node[]
  const report = (node: Node, verb: string) =>
    violations.push({ rule: 'bare-route-handler', file, line: lineOf(node), detail: verb })

  /** Top-level bindings, so `export { handler as GET }` resolves to what `handler` is. */
  const locals = new Map<string, Node>()
  for (const statement of body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? (statement.declaration as Node | null)
        : statement
    if (!declaration) continue
    if (declaration.type === 'FunctionDeclaration' && declaration.id) {
      locals.set((declaration.id as Node).name as string, declaration)
    }
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations as Node[]) {
        const id = declarator.id as Node
        if (id.type === 'Identifier') locals.set(id.name as string, declarator)
      }
    }
  }
  const isBare = (binding: Node | undefined): boolean =>
    binding?.type === 'FunctionDeclaration' ||
    (binding?.type === 'VariableDeclarator' && isHandlerBody(binding.init as Node | undefined))

  for (const statement of body) {
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
        if (id.type === 'Identifier' && HTTP_VERBS.has(id.name as string) && isBare(declarator)) {
          report(statement, id.name as string)
        }
      }
      continue
    }
    for (const specifier of statement.specifiers as Node[]) {
      const exported = specifier.exported as Node
      const verb =
        exported.type === 'Identifier' ? (exported.name as string) : stringValue(exported)
      const local = (specifier.local as Node | undefined)?.name as string | undefined
      if (verb && HTTP_VERBS.has(verb) && local && isBare(locals.get(local))) {
        report(statement, verb)
      }
    }
  }
  return violations
}

/** Unit, integration and live tests, plus fixtures: they bind real boundaries on purpose. */
function isTestFile(file: string): boolean {
  return /\.(?:test|spec|integration)\.tsx?$/.test(file) || file.includes('/__fixtures__/')
}

/** Every convention violation in one file; `file` is repo-relative with forward slashes. */
export function findViolations(file: string, source: string): Violation[] {
  if (!file.startsWith('apps/sim/') || !/\.tsx?$/.test(file) || file.endsWith('.d.ts')) return []
  const violations: Violation[] = []
  const wantsRelative = /(?:from|import|require)\s*\(?\s*['"`]\.\.?\//.test(source)
  const wantsStyle = file.endsWith('.tsx') && source.includes('style={{')
  const isApi = file.startsWith('apps/sim/app/api/') && !isTestFile(file)
  const wantsDb = isApi && source.includes('@sim/db')
  const wantsRoute = isApi && /(?:^|\/)route\.ts$/.test(file)

  if (!isTestFile(file)) violations.push(...findTextSizeLiterals(file, source))
  if (!(wantsRelative || wantsStyle || wantsDb || wantsRoute)) return violations

  const program = parseSource(file, source)
  if (wantsRelative) violations.push(...findRelativeImports(file, program))
  if (wantsStyle && !isTestFile(file)) {
    violations.push(...findStaticInlineStyles(file, source, program))
  }
  if (wantsDb) violations.push(...findApiDbImports(file, program))
  if (wantsRoute) violations.push(...findBareRouteHandlers(file, program))
  return violations
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

function collect(): { counts: Required<Baseline>; violations: Violation[] } {
  const counts = Object.fromEntries(RULES.map((rule) => [rule, {}])) as Required<Baseline>
  const violations: Violation[] = []
  for (const file of sourceFiles()) {
    for (const violation of findViolations(file, readFileSync(path.join(ROOT, file), 'utf8'))) {
      violations.push(violation)
      counts[violation.rule][file] = (counts[violation.rule][file] ?? 0) + 1
    }
  }
  return { counts, violations }
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((file) => [file, counts[file]])
  )
}

function total(counts: Counts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/**
 * The committed baseline. A missing file fails closed: restore it from git. `--update --init` is
 * the only way to create one, and it accepts every current hit.
 */
function readBaseline(current: Required<Baseline>): Baseline {
  if (existsSync(BASELINE)) return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
  if (process.argv.includes('--update') && process.argv.includes('--init')) return current
  console.error(
    `✗ ${path.relative(ROOT, BASELINE)} is missing. Restore it from git; ` +
      'create a new one only with --update --init.'
  )
  process.exit(1)
}

function update(current: Required<Baseline>, baseline: Baseline): never {
  const initRule = argValue('--init-rule')
  if (initRule !== undefined) {
    if (!(RULES as readonly string[]).includes(initRule)) {
      console.error(`✗ --init-rule ${initRule}: not a rule in this script (${RULES.join(', ')})`)
      process.exit(1)
    }
    if (baseline[initRule as Rule] !== undefined) {
      console.error(
        `✗ --init-rule ${initRule}: the baseline already tracks this rule, so its debt can only ` +
          'shrink. Fix the new hits instead.'
      )
      process.exit(1)
    }
  }
  const next: Baseline = {}
  const raised: string[] = []
  for (const rule of RULES) {
    if (rule === initRule) {
      next[rule] = sorted(current[rule])
      continue
    }
    const before = baseline[rule]
    if (before === undefined) {
      if (Object.keys(current[rule]).length) {
        console.error(
          `✗ ${rule} is not in the baseline. Admit its existing hits once with ` +
            `--update --init-rule ${rule}.`
        )
        process.exit(1)
      }
      next[rule] = {}
      continue
    }
    for (const [file, count] of Object.entries(current[rule])) {
      if (count > (before[file] ?? 0)) {
        raised.push(`  ${rule} ${file}: ${count} (baseline ${before[file] ?? 0})`)
      }
    }
    next[rule] = sorted(
      Object.fromEntries(
        Object.entries(current[rule])
          .map(([file, count]): [string, number] => [file, Math.min(count, before[file] ?? 0)])
          .filter(([, count]) => count > 0)
      )
    )
  }
  if (raised.length) {
    console.error(`✗ refused to raise the baseline for ${raised.length} file(s); fix them instead:`)
    console.error(raised.sort().join('\n'))
    process.exit(1)
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(
    `Wrote ${path.relative(ROOT, BASELINE)}: ` +
      RULES.map((rule) => `${rule} ${total(next[rule] ?? {})}`).join(', ')
  )
  process.exit(0)
}

function main(): void {
  const { counts: current, violations } = collect()
  const baseline = readBaseline(current)
  if (process.argv.includes('--update')) update(current, baseline)

  let regressed = 0
  let stale = 0
  let vanished = false
  for (const rule of RULES) {
    const before = baseline[rule] ?? {}
    const after = current[rule]
    const raisedFiles = Object.entries(after)
      .filter(([file, count]) => count > (before[file] ?? 0))
      .map(([file]) => file)
      .sort()
    const shrunk = Object.entries(before)
      .filter(([file, count]) => (after[file] ?? 0) < count)
      .map(([file, count]) => `  ${file}: ${after[file] ?? 0} (baseline ${count})`)
    if (Object.keys(before).some((file) => !(file in after))) vanished = true
    if (raisedFiles.length) {
      console.error(`✗ ${rule}: ${raisedFiles.length} file(s) gained hits`)
      for (const file of raisedFiles) {
        console.error(`  ${file}: ${after[file]} (baseline ${before[file] ?? 0})`)
        for (const violation of violations) {
          if (violation.rule === rule && violation.file === file) {
            console.error(`    ${file}:${violation.line} ${violation.detail}`)
          }
        }
      }
      console.error(`  ${HOW_TO_FIX[rule]}\n`)
    }
    if (shrunk.length) {
      console.error(`✗ ${rule}: ${shrunk.length} file(s) dropped below the baseline`)
      console.error(shrunk.sort().join('\n'))
    }
    regressed += raisedFiles.length
    stale += shrunk.length
  }

  if (regressed || stale) {
    if (stale) {
      console.error(
        '\nCounts dropped — shrink the baseline so they cannot creep back: ' +
          'bun run scripts/check-source-conventions.ts --update'
      )
    }
    if (regressed) console.error('\nNever raise the baseline to make a new hit pass.')
    if (regressed && vanished) {
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
