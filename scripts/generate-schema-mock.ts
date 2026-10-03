#!/usr/bin/env bun
/**
 * Generates `packages/testing/src/mocks/schema-tables.generated.ts` from `packages/db/schema.ts`:
 * every `pgTable` export with its column property names, every `pgEnum` export with its values,
 * and every other runtime export whose initializer is a plain literal (string, number, array or
 * object of literals) — plus the literal exports of the other `@sim/db` barrel modules
 * (`pool-profiles.ts`, `triggers.ts`), which the global `@sim/db` mock re-exports.
 *
 * `schemaMock` (`@sim/testing/mocks/schema.mock`) fills itself from this data, so a table or
 * column added to the real schema reaches the unit-test mock without a hand edit — tests stopped
 * re-mocking `@sim/db/schema` locally just because a new column was missing. Only names and
 * literal values are copied; the mock never imports drizzle table objects at runtime.
 *
 * Run: `bun run scripts/generate-schema-mock.ts` (write) or `--check` (fail on drift; collected by
 * `check:audits` as `check:schema-mock`).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_PATH = join(ROOT, 'packages/db/schema.ts')
const OUTPUT_PATH = join(ROOT, 'packages/testing/src/mocks/schema-tables.generated.ts')
/** Non-schema `@sim/db` barrel modules whose literal exports the `@sim/db` mock re-exports. */
const DB_BARREL_FILES = ['packages/db/pool-profiles.ts', 'packages/db/triggers.ts'] as const

/** True when `node` is a literal the generated file can reproduce verbatim. */
function isPlainLiteral(node: ts.Expression): boolean {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isPlainLiteral)
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        isPlainLiteral(property.initializer)
    )
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return isPlainLiteral(node.expression)
  }
  return false
}

/** Evaluates a plain literal (see {@link isPlainLiteral}) to its JSON value. */
function literalValue(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue)
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return literalValue(node.expression)
  }
  const record: Record<string, unknown> = {}
  for (const property of (node as ts.ObjectLiteralExpression).properties) {
    const assignment = property as ts.PropertyAssignment
    record[(assignment.name as ts.Identifier | ts.StringLiteral).text] = literalValue(
      assignment.initializer
    )
  }
  return record
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
  )
}

function collect(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const tables: Record<string, string[]> = {}
  const enums: Record<string, unknown[]> = {}
  const constants: Record<string, unknown> = {}
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const name = declaration.name.text
      const initializer = declaration.initializer
      if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)) {
        const callee = initializer.expression.text
        const [, second] = initializer.arguments
        if (callee === 'pgTable' && second && ts.isObjectLiteralExpression(second)) {
          tables[name] = second.properties.flatMap((property) =>
            property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
              ? [property.name.text]
              : []
          )
        } else if (callee === 'pgEnum' && second && isPlainLiteral(second)) {
          enums[name] = literalValue(second) as unknown[]
        }
        continue
      }
      if (isPlainLiteral(initializer)) constants[name] = literalValue(initializer)
    }
  }
  return { tables, enums, constants }
}

function render(): string {
  const { tables, enums, constants } = collect(SCHEMA_PATH)
  const barrelConstants: Record<string, unknown> = {}
  for (const file of DB_BARREL_FILES)
    Object.assign(barrelConstants, collect(join(ROOT, file)).constants)
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  return `/**
 * Generated by \`scripts/generate-schema-mock.ts\` from \`packages/db/schema.ts\` — do not edit.
 * Regenerate with \`bun run scripts/generate-schema-mock.ts\`; \`check:schema-mock\` fails on drift.
 */

/** Every \`pgTable\` export mapped to its column property names. */
export const GENERATED_SCHEMA_TABLES = ${json(tables)} as const

/** Every \`pgEnum\` export mapped to its values. */
export const GENERATED_SCHEMA_ENUMS = ${json(enums)} as const

/** Every other schema export whose initializer is a plain literal. */
export const GENERATED_SCHEMA_CONSTANTS = ${json(constants)} as const

/** Literal exports of the other \`@sim/db\` barrel modules (${DB_BARREL_FILES.join(', ')}). */
export const GENERATED_DB_CONSTANTS = ${json(barrelConstants)} as const
`
}

const format = Bun.spawnSync(['bunx', 'biome', 'format', '--stdin-file-path', OUTPUT_PATH], {
  cwd: ROOT,
  stdin: new TextEncoder().encode(render()),
})
if (format.exitCode !== 0) {
  console.error(format.stderr.toString())
  process.exit(1)
}
const output = format.stdout.toString()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUTPUT_PATH, 'utf8')
  } catch {}
  if (current !== output) {
    console.error(
      'packages/testing/src/mocks/schema-tables.generated.ts is out of date with packages/db/schema.ts.\n' +
        'Run: bun run scripts/generate-schema-mock.ts'
    )
    process.exit(1)
  }
  console.log('schema mock tables are up to date')
} else {
  writeFileSync(OUTPUT_PATH, output)
  console.log(`wrote ${OUTPUT_PATH}`)
}
