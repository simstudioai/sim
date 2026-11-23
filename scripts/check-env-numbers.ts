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
 * `envNumber` or of a function in {@link NORMALIZERS}, which parse their argument that way. A read
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

/** Functions that take the raw value as their first argument and return a normalized number. */
const NORMALIZERS = new Set(['envNumber', 'resolveCostMultiplier'])

/** The module that exports the app's `env`, from the repo root. */
const ENV_MODULE = 'apps/sim/lib/core/config/env'

/** Whether `specifier`, imported by `file` (from the repo root), names the module behind `env`. */
function importsEnvModule(file: string, specifier: string): boolean {
  const target = specifier.startsWith('@/')
    ? path.posix.join('apps/sim', specifier.slice(2))
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(file), specifier)
      : null
  return target !== null && target.replace(/\.(ts|tsx)$/, '') === ENV_MODULE
}

export interface RawNumericRead {
  line: number
  name: string
  text: string
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

/** The local names this file binds the app's `env` object to. */
function envBindings(file: string, sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    if (!importsEnvModule(file, statement.moduleSpecifier.text)) continue
    const named = statement.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    for (const element of named.elements) {
      if ((element.propertyName ?? element.name).text === 'env' && !element.isTypeOnly) {
        names.add(element.name.text)
      }
    }
  }
  return names
}

/** Whether `node` is the first argument of a call to one of {@link NORMALIZERS}. */
function isNormalized(node: ts.Node): boolean {
  const parent = node.parent
  return (
    ts.isCallExpression(parent) &&
    parent.arguments[0] === node &&
    ts.isIdentifier(parent.expression) &&
    NORMALIZERS.has(parent.expression.text)
  )
}

/** Every read of a variable in `numeric` through the app's `env` that is not normalized. */
export function findRawNumericReads(
  file: string,
  source: string,
  numeric: ReadonlySet<string>
): RawNumericRead[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const bindings = envBindings(file, sourceFile)
  if (bindings.size === 0) return []
  const lines = source.split('\n')
  const found: RawNumericRead[] = []

  const report = (node: ts.Node, name: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    const annotated = lines
      .slice(Math.max(0, line - ANNOTATION_REACH), line)
      .some((text) => text.trim().startsWith(ANNOTATION))
    if (!annotated) found.push({ line: line + 1, name, text: lines[line].trim() })
  }

  const isEnv = (node: ts.Expression): boolean => ts.isIdentifier(node) && bindings.has(node.text)

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isEnv(node.expression)) {
      if (numeric.has(node.name.text) && !isNormalized(node)) report(node, node.name.text)
    } else if (
      ts.isElementAccessExpression(node) &&
      isEnv(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const name = node.argumentExpression.text
      if (numeric.has(name) && !isNormalized(node)) report(node, name)
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
