#!/usr/bin/env bun
/**
 * Fails when a sealed-text column (`sealedText(...)` in `packages/db/schema.ts`) is compared or
 * read in a way that bypasses its sealing.
 *
 * - `comparison`: a Drizzle comparison operator against the column. Its bound parameter goes
 *   through the column's mapper, so a process that seals writes compares the sealed form and
 *   misses rows stored before sealing (ordering and pattern operators are meaningless on
 *   ciphertext). `sealedTextEquals` from `@sim/db/sealed-text` matches both forms; `isNull` and
 *   `isNotNull` are unaffected and allowed.
 * - `raw-interpolation`: `${table.column}` inside a raw `sql` template. A raw expression is read
 *   or compared as stored, so it sees ciphertext; select the column itself, or use the helper.
 * - `raw-column-name`: the physical column name inside a `sql` template or `sql.raw(...)` body, a
 *   `sql.identifier(...)` of it, or a `* FROM <table>` wildcard over its table, all of which read
 *   the stored form the same way. Tests and the sealing backfill read it on purpose.
 *
 * Table aliases count as the table: renamed imports from `@sim/db` / `@sim/db/schema` and
 * `alias(table, ...)` bindings.
 *
 * Swept clean when it landed, so there is no baseline: every hit fails.
 *
 * Run: `bun run check:sealed-columns`
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeRegExp } from '@sim/utils/string'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA = 'packages/db/schema.ts'
const SKIPPED_FILES = new Set([
  'packages/db/sealed-text.ts',
  'scripts/check-sealed-columns.test.ts',
])
/** Files that read the stored form on purpose, so only `raw-column-name` skips them. */
const STORED_FORM_READERS =
  /(?:\.test\.tsx?|\.integration\.ts|\/scripts\/test-[\w-]+-e2e\.ts)$|^packages\/db\/script-migrations\/0037_seal_account_tokens\.ts$/
const SCAN_DIRS = ['apps', 'packages', 'scripts']
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build', 'out'])
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/

const TABLE_DECLARATION = /export const (\w+) = pgTable\(\s*'(\w+)'/g
const SEALED_COLUMN = /(\w+):\s*sealedText\(\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g
const COMPARISON_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'notBetween',
  'like',
  'notLike',
  'ilike',
  'notIlike',
  'inArray',
  'notInArray',
  'arrayContains',
  'arrayContained',
  'arrayOverlaps',
]
const SQL_TEMPLATE = /\bsql(?:<[^>\n]*>)?`((?:[^`\\]|\\.)*)`/g
const SQL_RAW = /\bsql\.raw\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/g
const SQL_IDENTIFIER = /\bsql\.identifier\(\s*(['"`])(\w+)\1/g

type Rule = 'comparison' | 'raw-interpolation' | 'raw-column-name'

interface Violation {
  file: string
  line: number
  rule: Rule
  text: string
}

interface SealedColumn {
  /** The table's export name (`account`). */
  table: string
  /** The column's property (`accessToken`). */
  property: string
  /** The physical table name (`account`). */
  tableName: string
  /** The physical column name (`access_token`). */
  columnName: string
  /** How code references it, for reports (`account.accessToken`). */
  reference: string
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** Reads every sealed column from the schema. */
export function readSealedColumns(schemaSource: string): SealedColumn[] {
  const tables = [...schemaSource.matchAll(TABLE_DECLARATION)].map((match) => ({
    exportName: match[1],
    tableName: match[2],
    index: match.index ?? 0,
  }))
  const columns: SealedColumn[] = []
  for (const match of schemaSource.matchAll(SEALED_COLUMN)) {
    const [, property, , columnName] = match
    const table = tables.filter((candidate) => candidate.index < (match.index ?? 0)).at(-1)
    if (!table) continue
    columns.push({
      table: table.exportName,
      tableName: table.tableName,
      property,
      columnName,
      reference: `${table.exportName}.${property}`,
    })
  }
  return columns
}

/**
 * The local names a file binds `table` to: itself, any `import { table as x }` rename, and any
 * `const x = alias(table, ...)`.
 */
function tableNames(source: string, table: string): string[] {
  const escaped = escapeRegExp(table)
  const rename = new RegExp(`\\b${escaped}\\s+as\\s+(\\w+)`, 'g')
  const imports =
    source.match(/import\s+(?:type\s+)?\{[^}]*\}\s*from\s*'@sim\/db(?:\/schema)?'/g) ?? []
  const renames = imports.flatMap((statement) => [...statement.matchAll(rename)].map((m) => m[1]))
  const aliasBinding = new RegExp(`\\b(\\w+)\\s*=\\s*alias\\(\\s*(?:\\w+\\.)?${escaped}\\b`, 'g')
  const aliases = [...source.matchAll(aliasBinding)].map((m) => m[1])
  return [table, ...renames, ...aliases]
}

/** Finds comparisons and raw reads of `columns` in one source file. */
export function findViolations(file: string, source: string, columns: SealedColumn[]): Violation[] {
  const violations: Violation[] = []
  const report = (rule: Rule, index: number, text: string) =>
    violations.push({ file, line: lineOf(source, index), rule, text })
  const operators = COMPARISON_OPERATORS.join('|')
  for (const { table, property } of columns) {
    const names = tableNames(source, table).map(escapeRegExp).join('|')
    const column = `(?:\\w+\\.)?(?:${names})\\.${escapeRegExp(property)}\\b`
    const patterns: [Rule, RegExp][] = [
      ['comparison', new RegExp(`\\b(?:${operators})\\(\\s*${column}`, 'g')],
      ['raw-interpolation', new RegExp(`\\$\\{\\s*${column}\\s*\\}`, 'g')],
    ]
    for (const [rule, pattern] of patterns) {
      for (const match of source.matchAll(pattern)) report(rule, match.index ?? 0, match[0])
    }
  }
  if (STORED_FORM_READERS.test(file)) return violations
  const columnNames = new Set(columns.map((column) => column.columnName))
  const names = new RegExp(`\\b(?:${[...columnNames].map(escapeRegExp).join('|')})\\b`)
  const tables = [...new Set(columns.map((column) => column.tableName))].map(escapeRegExp).join('|')
  const wildcard = new RegExp(`\\*\\s*from\\s+(?:"?public"?\\.)?"?(?:${tables})"?(?![\\w"])`, 'i')
  for (const pattern of [SQL_TEMPLATE, SQL_RAW]) {
    for (const match of source.matchAll(pattern)) {
      const capture = match[match.length - 1]
      const bodyOffset = (match.index ?? 0) + match[0].lastIndexOf(capture)
      const body = capture.replace(/\$\{[^}]*\}/g, (value) => ' '.repeat(value.length))
      const hit = names.exec(body) ?? wildcard.exec(body)
      if (hit) report('raw-column-name', bodyOffset + hit.index, hit[0])
    }
  }
  for (const match of source.matchAll(SQL_IDENTIFIER)) {
    if (columnNames.has(match[2])) report('raw-column-name', match.index ?? 0, match[0])
  }
  return violations
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(path.join(dir, entry.name))
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      yield path.join(dir, entry.name)
    }
  }
}

if (import.meta.main) {
  const columns = readSealedColumns(readFileSync(path.join(ROOT, SCHEMA), 'utf8'))
  const violations: Violation[] = []
  if (columns.length === 0) {
    console.error(`No sealedText columns found in ${SCHEMA}; update this audit with the schema.`)
    process.exit(1)
  }
  for (const dir of SCAN_DIRS) {
    for (const absolute of sourceFiles(path.join(ROOT, dir))) {
      const file = path.relative(ROOT, absolute)
      if (SKIPPED_FILES.has(file)) continue
      violations.push(...findViolations(file, readFileSync(absolute, 'utf8'), columns))
    }
  }
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line} [${violation.rule}] ${violation.text}`)
    }
    console.error(
      `\n${violations.length} sealed-column violation(s). Compare with sealedTextEquals from @sim/db/sealed-text, and select the column instead of interpolating it into raw SQL.`
    )
    process.exit(1)
  }
  console.log(`✓ sealed columns (${columns.map((column) => column.reference).join(', ')})`)
}
