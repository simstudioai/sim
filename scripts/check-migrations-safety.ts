#!/usr/bin/env bun
/**
 * Guards new Drizzle migrations against deploy-window downtime.
 *
 * During a deploy the previously-deployed app code keeps serving against the
 * freshly-migrated schema (blue/green keeps both versions live). A migration
 * that is backward-incompatible with that older code — drops a column it still
 * reads, renames, adds a NOT NULL its inserts don't populate — throws until the
 * new code takes over. The fix is the expand/contract discipline: additive now,
 * destructive only after the dependent code is gone.
 *
 * This lint is the deterministic half of that guard (the `/db-migrate` skill is
 * the judgment half). It classifies every statement in migrations added on this
 * branch:
 *   - HARD ERROR: ops that are essentially never one-deploy-safe. Rewrite them.
 *   - ANNOTATE:   legitimate contract-phase ops. Acknowledge each with a
 *                 `-- migration-safe: <reason>` comment on the preceding line(s),
 *                 only after confirming the dependent code already shipped out.
 *   - WARN:       data backfills — surfaced for review, never block.
 *
 * Scope is new migration files only (git diff vs base); the existing corpus is
 * grandfathered. Usage:
 *   bun run scripts/check-migrations-safety.ts [baseRef]   # base defaults to origin/staging
 *   bun run scripts/check-migrations-safety.ts --all          # whole corpus
 *   bun run scripts/check-migrations-safety.ts --dir <path>   # a directory
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const MIGRATIONS_DIR = 'packages/db/migrations'
const ANNOTATION_PREFIX = '-- migration-safe:'

type Tier = 'error' | 'warn'

interface Finding {
  line: number
  statement: string
  tier: Tier
  rule: string
  message: string
}

interface Statement {
  sql: string
  startLine: number
}

/** Strip quotes and any schema prefix so `"public"."user"` and `"user"` match. */
function bareName(raw: string): string {
  const unquoted = raw.replace(/"/g, '')
  const parts = unquoted.split('.')
  return (parts[parts.length - 1] ?? unquoted).toLowerCase()
}

/**
 * Split SQL into statements with their 1-based start line, respecting line
 * comments (`--`), block comments, and single-quoted strings so a `;` inside
 * any of them does not terminate a statement.
 */
function parseStatements(content: string): Statement[] {
  const statements: Statement[] = []
  let buf = ''
  let startOffset = -1
  let inLine = false
  let inBlock = false
  let inStr = false
  let dollarTag: string | null = null

  const lineAt = (offset: number): number => {
    let line = 1
    for (let i = 0; i < offset; i++) if (content[i] === '\n') line++
    return line
  }
  const flush = () => {
    const sql = buf.trim()
    if (sql.length > 0 && startOffset >= 0) statements.push({ sql, startLine: lineAt(startOffset) })
    buf = ''
    startOffset = -1
  }

  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    const next = content[i + 1]

    if (inLine) {
      if (c === '\n') inLine = false
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inStr) {
      buf += c
      if (c === "'") {
        if (next === "'") {
          buf += "'"
          i++
        } else {
          inStr = false
        }
      }
      continue
    }
    if (dollarTag) {
      if (c === '$' && content.startsWith(dollarTag, i)) {
        buf += dollarTag
        i += dollarTag.length - 1
        dollarTag = null
      } else {
        buf += c
      }
      continue
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(content.slice(i))?.[0]
      if (tag) {
        if (startOffset < 0) startOffset = i
        dollarTag = tag
        buf += tag
        i += tag.length - 1
        continue
      }
    }
    if (c === '-' && next === '-') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    if (c === "'") {
      inStr = true
      if (startOffset < 0) startOffset = i
      buf += c
      continue
    }
    if (c === ';') {
      flush()
      continue
    }
    if (startOffset < 0 && !/\s/.test(c)) startOffset = i
    buf += c
  }
  flush()
  return statements
}

/**
 * Mirror of the api-validation annotation reader, for `--` SQL comments:
 * scans up to three consecutive non-empty preceding lines for the prefix.
 * `allowed` when a non-empty reason follows; `missingReason` flags a dangling
 * annotation so it fails rather than silently passing.
 */
function readAnnotation(
  lines: string[],
  startLine: number
): { allowed: boolean; missingReason: boolean } {
  let inspected = 0
  for (let i = startLine - 2; i >= 0 && inspected < 3; i--) {
    const trimmed = lines[i]?.trim() ?? ''
    if (trimmed.length === 0) continue
    inspected++
    if (!trimmed.startsWith('--')) return { allowed: false, missingReason: false }
    const idx = trimmed.indexOf(ANNOTATION_PREFIX)
    if (idx === -1) continue
    const reason = trimmed.slice(idx + ANNOTATION_PREFIX.length).trim()
    if (reason.length === 0) return { allowed: false, missingReason: true }
    return { allowed: true, missingReason: false }
  }
  return { allowed: false, missingReason: false }
}

interface RawMatch {
  kind: 'error' | 'annotate' | 'warn'
  rule: string
  message: string
}

/**
 * Classify one statement. `createdTables` holds tables created in the same
 * migration — ops against a brand-new table have no old rows and no live
 * traffic, so they are always safe and skipped. `sawCommit` tracks whether a
 * `COMMIT;` breakpoint preceded a CONCURRENTLY index (see migrate.ts).
 */
function classify(sql: string, createdTables: Set<string>, sawCommit: boolean): RawMatch[] {
  const s = sql.replace(/\s+/g, ' ').trim()
  const matches: RawMatch[] = []

  const alterTable = s.match(/\bALTER TABLE (?:IF EXISTS )?(?:ONLY )?("?[.\w]+"?)/i)
  const targetTable = alterTable ? bareName(alterTable[1]) : null
  const onNewTable = targetTable !== null && createdTables.has(targetTable)

  if (/^CREATE (?:UNIQUE )?INDEX\b/i.test(s)) {
    const on = s.match(/\bON ("?[.\w]+"?)/i)
    const indexTable = on ? bareName(on[1]) : null
    const concurrent = /\bCONCURRENTLY\b/i.test(s)
    if (!(indexTable && createdTables.has(indexTable))) {
      if (!concurrent) {
        matches.push({
          kind: 'error',
          rule: 'index-not-concurrent',
          message:
            'CREATE INDEX on an existing table write-locks it for the whole build. Use CREATE INDEX CONCURRENTLY IF NOT EXISTS after a COMMIT; breakpoint (see packages/db/scripts/migrate.ts).',
        })
      } else if (!/\bIF NOT EXISTS\b/i.test(s)) {
        matches.push({
          kind: 'error',
          rule: 'concurrent-index-not-idempotent',
          message:
            'CREATE INDEX CONCURRENTLY must be IF NOT EXISTS — a failed build replays from the top and a partial INVALID index would be skipped forever.',
        })
      } else if (!sawCommit) {
        matches.push({
          kind: 'error',
          rule: 'concurrent-index-no-commit',
          message:
            'CREATE INDEX CONCURRENTLY cannot run inside the migration transaction. Precede it with a COMMIT; breakpoint and SET lock_timeout = 0 (see packages/db/scripts/migrate.ts).',
        })
      }
    }
  }

  if (
    !onNewTable &&
    /\bADD COLUMN\b/i.test(s) &&
    /\bNOT NULL\b/i.test(s) &&
    !/\bDEFAULT\b/i.test(s)
  ) {
    matches.push({
      kind: 'error',
      rule: 'add-not-null-no-default',
      message:
        'ADD COLUMN NOT NULL with no DEFAULT breaks old inserts (and fails on existing rows). Add it nullable or with a DEFAULT, backfill, then SET NOT NULL in a later migration once code populates it.',
    })
  }

  if (/\bRENAME COLUMN\b/i.test(s) || /^ALTER TABLE\b[^;]*\bRENAME TO\b/i.test(s)) {
    matches.push({
      kind: 'error',
      rule: 'rename',
      message:
        'RENAME of a column/table breaks old code reading the old name. Add the new column/table, dual-write in code, then drop the old one in a later deploy.',
    })
  }

  if (
    !onNewTable &&
    /\bADD CONSTRAINT\b/i.test(s) &&
    /\b(FOREIGN KEY|CHECK)\b/i.test(s) &&
    !/\bNOT VALID\b/i.test(s)
  ) {
    matches.push({
      kind: 'error',
      rule: 'constraint-not-valid',
      message:
        'ADD CONSTRAINT FOREIGN KEY/CHECK on an existing table locks it and rejects old writes that violate it. Add it NOT VALID, then VALIDATE CONSTRAINT in a separate step.',
    })
  }

  if (!onNewTable) {
    if (/^DROP TABLE\b/i.test(s)) {
      matches.push({ kind: 'annotate', rule: 'drop-table', message: 'DROP TABLE' })
    }
    if (/\bDROP COLUMN\b/i.test(s)) {
      matches.push({ kind: 'annotate', rule: 'drop-column', message: 'DROP COLUMN' })
    }
    if (/\bDROP CONSTRAINT\b/i.test(s)) {
      matches.push({ kind: 'annotate', rule: 'drop-constraint', message: 'DROP CONSTRAINT' })
    }
    if (/\bDROP DEFAULT\b/i.test(s)) {
      matches.push({ kind: 'annotate', rule: 'drop-default', message: 'DROP DEFAULT' })
    }
    if (/\bSET NOT NULL\b/i.test(s)) {
      matches.push({ kind: 'annotate', rule: 'set-not-null', message: 'SET NOT NULL' })
    }
    if (/\bSET DATA TYPE\b/i.test(s) || /\bALTER COLUMN ("?[.\w]+"?) TYPE\b/i.test(s)) {
      matches.push({ kind: 'annotate', rule: 'alter-type', message: 'column type change' })
    }
  }
  if (/^DROP INDEX\b/i.test(s)) {
    if (!/\bCONCURRENTLY\b/i.test(s)) {
      matches.push({
        kind: 'error',
        rule: 'drop-index-not-concurrent',
        message:
          'Plain DROP INDEX takes an ACCESS EXCLUSIVE lock on the table for the whole drop. Use DROP INDEX CONCURRENTLY after a COMMIT; breakpoint (see packages/db/scripts/migrate.ts).',
      })
    } else if (!/\bIF EXISTS\b/i.test(s)) {
      matches.push({
        kind: 'error',
        rule: 'concurrent-drop-index-not-idempotent',
        message:
          'DROP INDEX CONCURRENTLY must be IF EXISTS — a failed run replays from the top and would abort re-dropping an already-gone index.',
      })
    } else if (!sawCommit) {
      matches.push({
        kind: 'error',
        rule: 'concurrent-drop-index-no-commit',
        message:
          'DROP INDEX CONCURRENTLY cannot run inside the migration transaction. Precede it with a COMMIT; breakpoint (see packages/db/scripts/migrate.ts).',
      })
    }
  }

  if (/^(UPDATE|DELETE)\b/i.test(s)) {
    const noWhere = !/\bWHERE\b/i.test(s)
    matches.push({
      kind: 'warn',
      rule: 'data-backfill',
      message: noWhere
        ? 'data backfill with no WHERE rewrites/locks the whole table. Confirm it is batched, idempotent, and safe under concurrent writes.'
        : 'data backfill. Confirm it is batched, idempotent, and safe under concurrent writes.',
    })
  }

  return matches
}

const ANNOTATE_GUIDANCE =
  'is a contract-phase op. Confirm the old code no longer reads/writes it (it must have shipped in an earlier deploy — not this same PR), then acknowledge with a `-- migration-safe: <reason>` comment on the line above.'

/** Lint a single migration's SQL. Returns only actionable findings. */
export function lintSql(content: string): Finding[] {
  const lines = content.split('\n')
  const statements = parseStatements(content)
  const createdTables = new Set<string>()
  for (const { sql } of statements) {
    const m = sql.match(/^CREATE TABLE (?:IF NOT EXISTS )?("?[.\w]+"?)/i)
    if (m) createdTables.add(bareName(m[1]))
  }

  const findings: Finding[] = []
  let sawCommit = false
  for (const { sql, startLine } of statements) {
    for (const match of classify(sql, createdTables, sawCommit)) {
      if (match.kind === 'error') {
        findings.push({
          line: startLine,
          statement: sql,
          tier: 'error',
          rule: match.rule,
          message: match.message,
        })
      } else if (match.kind === 'warn') {
        findings.push({
          line: startLine,
          statement: sql,
          tier: 'warn',
          rule: match.rule,
          message: match.message,
        })
      } else {
        const ann = readAnnotation(lines, startLine)
        if (ann.allowed) continue
        findings.push({
          line: startLine,
          statement: sql,
          tier: 'error',
          rule: match.rule,
          message: ann.missingReason
            ? `${match.message}: \`-- migration-safe:\` annotation has no reason. Give it a real justification.`
            : `${match.message} ${ANNOTATE_GUIDANCE}`,
        })
      }
    }
    if (/^COMMIT\b/i.test(sql.trim())) sawCommit = true
  }
  return findings
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/** New migration files on this branch vs base, plus uncommitted ones locally. */
function changedMigrationFiles(baseRef: string): string[] {
  const files = new Set<string>()
  const inDir = (p: string) => p.startsWith(`${MIGRATIONS_DIR}/`) && p.endsWith('.sql')

  const mergeBase = git(['merge-base', baseRef, 'HEAD']) ?? baseRef
  const committed = git([
    'diff',
    '--name-only',
    '--diff-filter=AM',
    mergeBase,
    'HEAD',
    '--',
    MIGRATIONS_DIR,
  ])
  if (committed === null) return [] // git unavailable → fail open (handled by caller)
  for (const f of committed.split('\n')) if (inDir(f)) files.add(f)

  const status = git(['status', '--porcelain', '--', MIGRATIONS_DIR])
  if (status) {
    for (const raw of status.split('\n')) {
      const p = raw.slice(3).trim()
      if (inDir(p)) files.add(p)
    }
  }
  // A migration deleted in the working tree (e.g. regenerated before commit) has
  // no SQL left to lint — skip it rather than crash on the read.
  return [...files].filter((f) => existsSync(path.join(ROOT, f)))
}

async function listSqlFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listSqlFiles(full)))
    else if (e.name.endsWith('.sql')) out.push(full)
  }
  return out
}

async function resolveFiles(argv: string[]): Promise<string[] | null> {
  if (argv.includes('--all')) {
    return (await listSqlFiles(path.join(ROOT, MIGRATIONS_DIR))).map((f) => path.relative(ROOT, f))
  }
  const dirIdx = argv.indexOf('--dir')
  if (dirIdx !== -1) {
    const dir = argv[dirIdx + 1]
    if (!dir) throw new Error('--dir requires a path')
    return (await listSqlFiles(path.resolve(dir))).map((f) => path.relative(ROOT, f))
  }
  const baseRef = argv.find((a) => !a.startsWith('--')) ?? 'origin/staging'
  const files = changedMigrationFiles(baseRef)
  if (files.length === 0 && git(['rev-parse', 'HEAD']) === null) {
    console.warn('⚠ git unavailable — skipping migration safety check.')
    return null
  }
  return files
}

async function main() {
  const files = await resolveFiles(process.argv.slice(2))
  if (files === null) process.exit(0)

  if (files.length === 0) {
    console.log('✓ No new migrations to check.')
    process.exit(0)
  }

  let errors = 0
  let warnings = 0
  for (const rel of files) {
    const content = await readFile(path.join(ROOT, rel), 'utf8')
    const findings = lintSql(content)
    if (findings.length === 0) continue

    console.error(`\n${rel}`)
    for (const f of findings.sort((a, b) => a.line - b.line)) {
      const icon = f.tier === 'error' ? '✗' : '⚠'
      if (f.tier === 'error') errors++
      else warnings++
      console.error(`  ${icon} ${rel}:${f.line}  [${f.rule}]`)
      console.error(`    ${f.statement.replace(/\s+/g, ' ').slice(0, 120)}`)
      console.error(`    → ${f.message}`)
    }
  }

  if (errors === 0) {
    console.log(
      warnings > 0
        ? `\n✓ No blocking migration issues (${warnings} warning(s) to review).`
        : '\n✓ Migrations are backward-compatible.'
    )
    process.exit(0)
  }
  console.error(
    `\nFound ${errors} blocking migration issue(s). Rewrite hard errors into expand/contract, or annotate contract ops once safe. See the /db-migrate skill.`
  )
  process.exit(1)
}

if (import.meta.main) main()
