#!/usr/bin/env bun
/**
 * Fails when a sealed-text column (`sealedText(...)` in `packages/db/schema.ts`) is compared or
 * interpolated in a way that bypasses its sealing.
 *
 * - `comparison`: `eq`/`ne`/`inArray`/`notInArray` against the column. The bound parameter goes
 *   through the column's mapper, so a process that seals writes compares the sealed form and
 *   misses rows stored before sealing. `sealedTextEquals` from `@sim/db/sealed-text` matches both.
 * - `raw-interpolation`: `${table.column}` inside a raw `sql` template. A raw expression is read
 *   or compared as stored, so it sees ciphertext; select the column itself, or use the helper.
 * - `context-mismatch`: a `sealedText(table, column)` whose table is not the one it is declared in.
 *   The pair is the authenticated context `sealedTextEquals` rebuilds from the column, so a
 *   mismatch makes every equality miss.
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
const HELPER = 'packages/db/sealed-text.ts'
const SCAN_DIRS = ['apps', 'packages', 'scripts']
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build', 'out'])
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/

const TABLE_DECLARATION = /export const (\w+) = pgTable\(\s*'(\w+)'/g
const SEALED_COLUMN = /(\w+):\s*sealedText\(\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g

type Rule = 'comparison' | 'raw-interpolation' | 'context-mismatch'

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
  /** How code references it, for reports (`account.accessToken`). */
  reference: string
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

/** Reads every sealed column from the schema and checks each names the table it is declared in. */
export function readSealedColumns(schemaSource: string): {
  columns: SealedColumn[]
  violations: Violation[]
} {
  const tables = [...schemaSource.matchAll(TABLE_DECLARATION)].map((match) => ({
    exportName: match[1],
    tableName: match[2],
    index: match.index ?? 0,
  }))
  const columns: SealedColumn[] = []
  const violations: Violation[] = []
  for (const match of schemaSource.matchAll(SEALED_COLUMN)) {
    const index = match.index ?? 0
    const [text, property, tableArg] = match
    const table = tables.filter((candidate) => candidate.index < index).at(-1)
    if (!table) continue
    columns.push({
      table: table.exportName,
      property,
      reference: `${table.exportName}.${property}`,
    })
    if (tableArg !== table.tableName) {
      violations.push({
        file: SCHEMA,
        line: lineOf(schemaSource, index),
        rule: 'context-mismatch',
        text,
      })
    }
  }
  return { columns, violations }
}

/** The local names a file binds `table` to: itself, plus any `import { table as alias }` rename. */
function tableNames(source: string, table: string): string[] {
  const rename = new RegExp(`\\b${escapeRegExp(table)}\\s+as\\s+(\\w+)`, 'g')
  const imports =
    source.match(/import\s+(?:type\s+)?\{[^}]*\}\s*from\s*'@sim\/db(?:\/schema)?'/g) ?? []
  const aliases = imports.flatMap((statement) => [...statement.matchAll(rename)].map((m) => m[1]))
  return [table, ...aliases]
}

/** Finds comparisons and raw interpolations of `columns` in one source file. */
export function findViolations(file: string, source: string, columns: SealedColumn[]): Violation[] {
  const violations: Violation[] = []
  for (const { table, property } of columns) {
    const names = tableNames(source, table).map(escapeRegExp).join('|')
    const column = `(?:\\w+\\.)?(?:${names})\\.${escapeRegExp(property)}\\b`
    const patterns: [Rule, RegExp][] = [
      ['comparison', new RegExp(`\\b(?:eq|ne|inArray|notInArray)\\(\\s*${column}`, 'g')],
      ['raw-interpolation', new RegExp(`\\$\\{\\s*${column}\\s*\\}`, 'g')],
    ]
    for (const [rule, pattern] of patterns) {
      for (const match of source.matchAll(pattern)) {
        violations.push({ file, line: lineOf(source, match.index ?? 0), rule, text: match[0] })
      }
    }
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
  const { columns, violations } = readSealedColumns(readFileSync(path.join(ROOT, SCHEMA), 'utf8'))
  if (columns.length === 0) {
    console.error(`No sealedText columns found in ${SCHEMA}; update this audit with the schema.`)
    process.exit(1)
  }
  for (const dir of SCAN_DIRS) {
    for (const absolute of sourceFiles(path.join(ROOT, dir))) {
      const file = path.relative(ROOT, absolute)
      if (file === HELPER || file === 'scripts/check-sealed-columns.test.ts') continue
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
