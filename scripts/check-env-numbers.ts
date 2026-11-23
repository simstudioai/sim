#!/usr/bin/env bun
/**
 * Keeps numeric environment variables read through `envNumber`.
 *
 * `apps/sim/lib/core/config/env.ts` declares a variable as `z.number()` or `z.coerce.number()`,
 * but runs `createEnv` with `skipValidation: true`, so the schema never executes and the value
 * arrives as the raw string from `process.env` or Helm. A string that reaches a numeric helper
 * fails there (`mapWithConcurrency` refuses a non-number limit, so PII masking failed whenever
 * `PII_MASK_CHUNK_CONCURRENCY` was set), and one that reaches arithmetic works until the value is
 * not a number. `envNumber(env.NAME, fallback, { min, integer })` normalizes the type at the
 * boundary and is the only supported way to read such a variable.
 *
 * So every read of a numeric variable through the `env` this repo's config exports (`env.NAME`,
 * `env['NAME']`, `const { NAME } = env`) fails this check unless it is the first argument of
 * `envNumber` or of a function in {@link NORMALIZERS}, imported from their module, which parse their argument that way. A read
 * its consumer parses itself, for a reason `envNumber` cannot express (an invalid value must
 * throw, or must stay distinct from an unset one), takes `// env-number-normalized: <reason>` on
 * one of the two lines above it.
 *
 * The numeric names come from the schema, so a variable declared numeric later is covered without
 * touching this file. Parsed with the TypeScript AST: strings and comments never count. The tree
 * was swept when this landed, so there is no baseline.
 *
 * Usage: bun run check:env-numbers
 */
import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_SCHEMA_FILE = 'apps/sim/lib/core/config/env.ts'
const SCAN_DIR = 'apps/sim'
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage'])
const ANNOTATION = '// env-number-normalized:'
const ANNOTATION_REACH = 2

/** The module that exports the app's `env`, from the repo root. */
const ENV_MODULE = 'apps/sim/lib/core/config/env'

/**
 * The functions that take the raw value as their first argument and return a normalized number,
 * by the module that exports them. A call only counts when its callee is bound by an import of
 * that module (or is the module's own declaration), so a local function of the same name does not.
 */
const NORMALIZERS: ReadonlyArray<{ module: string; name: string }> = [
  { module: ENV_MODULE, name: 'envNumber' },
  { module: 'apps/sim/lib/core/config/cost-multiplier', name: 'resolveCostMultiplier' },
]

/** The repo-root path an import `specifier` from `file` resolves to, without its extension. */
function resolveSpecifier(file: string, specifier: string): string | null {
  const target = specifier.startsWith('@/')
    ? path.posix.join('apps/sim', specifier.slice(2))
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(file), specifier)
      : null
  return target === null ? null : target.replace(/\.(ts|tsx)$/, '')
}

/** The variables the schema declares as numbers (`z.number()`, `z.coerce.number()`, any chain). */
export function numericEnvNames(schemaSource: string): Set<string> {
  const sourceFile = ts.createSourceFile('env.ts', schemaSource, ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      declaresNumber(node.initializer)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/** Whether a schema expression's chain starts at `z.number()` or `z.coerce.number()`. */
function declaresNumber(expression: ts.Expression): boolean {
  let current: ts.Expression = expression
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === 'number'
    ) {
      const owner = current.expression.expression
      return (
        (ts.isIdentifier(owner) && owner.text === 'z') ||
        (ts.isPropertyAccessExpression(owner) &&
          owner.name.text === 'coerce' &&
          ts.isIdentifier(owner.expression) &&
          owner.expression.text === 'z')
      )
    }
    current = current.expression
  }
  return false
}

/** What a file's imports bind: the app's `env`, namespaces over its module, and the normalizers. */
interface Bindings {
  env: Set<string>
  namespaces: Set<string>
  normalizers: Set<string>
  /** Namespaces over a normalizer's module, by the name they reach it as. */
  normalizerNamespaces: Map<string, Set<string>>
}

function importBindings(file: string, sourceFile: ts.SourceFile): Bindings {
  const bindings: Bindings = {
    env: new Set(),
    namespaces: new Set(),
    normalizers: new Set(),
    normalizerNamespaces: new Map(),
  }
  const own = resolveSpecifier(file, `./${path.posix.basename(file)}`)
  for (const normalizer of NORMALIZERS) {
    if (normalizer.module === own) bindings.normalizers.add(normalizer.name)
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const resolved = resolveSpecifier(file, statement.moduleSpecifier.text)
    const named = statement.importClause?.namedBindings
    if (resolved === null || !named) continue
    if (ts.isNamespaceImport(named)) {
      if (resolved === ENV_MODULE) bindings.namespaces.add(named.name.text)
      for (const normalizer of NORMALIZERS) {
        if (normalizer.module === resolved) {
          const names = bindings.normalizerNamespaces.get(named.name.text) ?? new Set<string>()
          names.add(normalizer.name)
          bindings.normalizerNamespaces.set(named.name.text, names)
        }
      }
      continue
    }
    for (const element of named.elements) {
      if (element.isTypeOnly) continue
      const imported = (element.propertyName ?? element.name).text
      if (resolved === ENV_MODULE && imported === 'env') bindings.env.add(element.name.text)
      if (NORMALIZERS.some((item) => item.module === resolved && item.name === imported)) {
        bindings.normalizers.add(element.name.text)
      }
    }
  }
  return bindings
}

/** Whether `node` is the first argument of a call to a normalizer this file imported. */
function isNormalized(node: ts.Node, bindings: Bindings): boolean {
  const parent = node.parent
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return false
  const callee = parent.expression
  if (ts.isIdentifier(callee)) return bindings.normalizers.has(callee.text)
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    bindings.normalizerNamespaces.get(callee.expression.text)?.has(callee.name.text) === true
  )
}

/** Every read of a variable in `numeric` through the app's `env` that is not normalized. */
export function findRawNumericReads(
  file: string,
  source: string,
  numeric: ReadonlySet<string>
): RawNumericRead[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const bindings = importBindings(file, sourceFile)
  if (bindings.env.size === 0 && bindings.namespaces.size === 0) return []
  const lines = source.split('\n')
  const found: RawNumericRead[] = []

  const report = (node: ts.Node, name: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    const annotated = lines
      .slice(Math.max(0, line - ANNOTATION_REACH), line)
      .some((text) => text.trim().startsWith(ANNOTATION))
    if (!annotated) found.push({ line: line + 1, name, text: lines[line].trim() })
  }

  const isEnv = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && bindings.env.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      node.name.text === 'env' &&
      ts.isIdentifier(node.expression) &&
      bindings.namespaces.has(node.expression.text))

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isEnv(node.expression)) {
      if (numeric.has(node.name.text) && !isNormalized(node, bindings)) report(node, node.name.text)
    } else if (
      ts.isElementAccessExpression(node) &&
      isEnv(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const name = node.argumentExpression.text
      if (numeric.has(name) && !isNormalized(node, bindings)) report(node, name)
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isEnv(node.initializer)
    ) {
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name
        if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && numeric.has(key.text)) {
          report(element, key.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`check-env-numbers: "${dir}" does not exist`)
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|integration|live\.test)\.tsx?$/.test(entry.name)
    )
      out.push(full)
  }
  return out
}

function main(): void {
  const numeric = numericEnvNames(readFileSync(path.join(ROOT, ENV_SCHEMA_FILE), 'utf8'))
  if (numeric.size === 0) {
    console.error(`✗ check-env-numbers: found no numeric variable in ${ENV_SCHEMA_FILE}`)
    process.exit(1)
  }
  const violations: Array<RawNumericRead & { file: string }> = []
  let scanned = 0
  for (const file of walk(path.join(ROOT, SCAN_DIR))) {
    scanned++
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    for (const hit of findRawNumericReads(rel, readFileSync(file, 'utf8'), numeric)) {
      violations.push({ file: rel, ...hit })
    }
  }

  if (violations.length === 0) {
    console.log(
      `✓ check-env-numbers: ${scanned} files, ${numeric.size} numeric variables, every read goes through envNumber`
    )
    process.exit(0)
  }

  console.error('✗ check-env-numbers: a numeric env variable read without envNumber\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}  env.${violation.name}`)
    console.error(`      ${violation.text}`)
  }
  console.error(
    '\nWith skipValidation the value is the raw string, so a numeric helper refuses it and arithmetic' +
      '\nonly works until it is not a number. Read it as envNumber(env.NAME, fallback, { min, integer }).' +
      `\nA read its consumer parses itself takes \`${ANNOTATION} <reason>\` on a line above it.`
  )
  process.exit(1)
}

if (import.meta.main) main()
