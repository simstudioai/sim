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

/** One SQL identifier, quoted or not. */
const IDENTIFIER = String.raw`(?:"[^"]+"|[\w$]+)`
/** A table reference: `table` or `schema.table`. */
const TABLE_NAME = String.raw`(${IDENTIFIER}(?:\.${IDENTIFIER})?)`

/**
 * The identifiers of a dotted name as PostgreSQL resolves them: a quoted identifier keeps its
 * case, an unquoted one folds to lower case.
 */
function identifiers(raw: string): string[] {
  return (raw.match(/"[^"]+"|[\w$]+/g) ?? []).map((part) =>
    part.startsWith('"') ? part.slice(1, -1) : part.toLowerCase()
  )
}

/** `schema.table` for a table reference; an unqualified table is in `public`. */
function qualifiedName(raw: string): string {
  const parts = identifiers(raw)
  return parts.length > 1 ? parts.slice(-2).join('.') : `public.${parts[0] ?? ''}`
}

/**
 * The statement with string literals and comments blanked, so only executable SQL is matched.
 * An escape string (`E'…'`) is read with its backslash escapes, so `\'` does not end it early.
 * A dollar-quoted body stays only where it runs, after `DO` or a function's `AS`, with its own
 * literals blanked in turn; dollar-quoted data is blanked like any other string.
 */
function executableSql(sql: string): string {
  return sql.replace(
    /\$(\w*)\$([\s\S]*?)\$\1\$|(?<![\w$])[Ee]'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (_match, tag: string | undefined, body: string | undefined, offset: number) => {
      if (body === undefined) return ' '
      const runs = /\b(?:DO|AS)\s*$|\bDO\s+LANGUAGE\s+\w+\s*$/i.test(sql.slice(0, offset))
      return runs ? `$${tag}$${executableSql(body)}$${tag}$` : ' '
    }
  )
}

/**
 * Statements that depend on who owns a table. Production keeps older tables owned by a
 * different role than the one that runs migrations, while every table in CI and staging belongs
 * to the migrator, so these pass everywhere but production. `newTables` holds the tables this
 * migration certainly creates (`CREATE TABLE` without `IF NOT EXISTS`), which the migrator owns.
 */
function ownershipMatches(sql: string, newTables: Set<string>): RawMatch[] {
  const s = executableSql(sql).replace(/\s+/g, ' ')
  const matches: RawMatch[] = []
  for (const ownedBy of s.matchAll(/\b(?:CREATE|ALTER) SEQUENCE\b[^;]*?\bOWNED BY ([^\s;]+)/gi)) {
    if (/^NONE$/i.test(ownedBy[1])) continue
    const table = identifiers(ownedBy[1]).slice(0, -1)
    const owner = table.length > 1 ? table.slice(-2).join('.') : `public.${table[0] ?? ''}`
    if (newTables.has(owner)) continue
    matches.push({
      kind: 'error',
      rule: 'sequence-owned-by-existing-table',
      message:
        'OWNED BY needs the sequence and its table to share an owner, and an existing table may belong to a different role than the one that created the sequence. Leave the sequence unowned, or link it only to a table this migration creates.',
    })
  }
  if (/\bOWNER TO\b/i.test(s)) {
    matches.push({
      kind: 'error',
      rule: 'owner-to',
      message:
        'Owner roles differ between environments, so OWNER TO is not portable. Ownership changes belong to an operator, not a migration.',
    })
  }
  return matches
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
 * migration, by schema-qualified name so a same-named table in another schema
 * is not mistaken for one — ops against a brand-new table have no old rows and no live
 * traffic, so they are always safe and skipped. `sawCommit` tracks whether a
 * `COMMIT;` breakpoint preceded a CONCURRENTLY index (see migrate.ts).
 */
function classify(sql: string, createdTables: Set<string>, sawCommit: boolean): RawMatch[] {
  const s = sql.replace(/\s+/g, ' ').trim()
  const matches: RawMatch[] = []

  const alterTable = s.match(
    new RegExp(String.raw`\bALTER TABLE (?:IF EXISTS )?(?:ONLY )?${TABLE_NAME}`, 'i')
  )
  const targetTable = alterTable ? qualifiedName(alterTable[1]) : null
  const onNewTable = targetTable !== null && createdTables.has(targetTable)

  if (/^CREATE (?:UNIQUE )?INDEX\b/i.test(s)) {
    const on = s.match(new RegExp(String.raw`\bON (?:ONLY )?${TABLE_NAME}`, 'i'))
    const indexTable = on ? qualifiedName(on[1]) : null
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
function lintSql(content: string): Finding[] {
  const lines = content.split('\n')
  const statements = parseStatements(content)
  const createdTables = new Set<string>()
  const newTables = new Set<string>()
  for (const { sql } of statements) {
    const m = sql.match(new RegExp(`^CREATE TABLE (IF NOT EXISTS )?${TABLE_NAME}`, 'i'))
    if (!m) continue
    createdTables.add(qualifiedName(m[2]))
    if (!m[1]) newTables.add(qualifiedName(m[2]))
  }

  const findings: Finding[] = []
  let sawCommit = false
  for (const { sql, startLine } of statements) {
    for (const match of [
      ...classify(sql, createdTables, sawCommit),
      ...ownershipMatches(sql, newTables),
    ]) {
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

/**
 * Raised when the base ref cannot be compared against `HEAD`.
 *
 * Distinct from "no migrations changed", which is the same empty list. Conflating
 * the two is how this check came to pass on a branch it had never read: an
 * unresolvable base made `git diff` fail, the failure became `[]`, and `[]`
 * printed as `✓ No new migrations to check`.
 */
class BaseRefUnusableError extends Error {
  constructor(readonly baseRef: string) {
    super(
      `Cannot diff against '${baseRef}'. The ref is missing, or was fetched without enough ` +
        `history for a merge-base. Fetch it with full history before running this check.`
    )
    this.name = 'BaseRefUnusableError'
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
  /* Only a missing git binary is a legitimate skip, and `resolveFiles` detects that
     separately. A diff that fails with git present means the ref is unusable. */
  if (committed === null) throw new BaseRefUnusableError(baseRef)
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
  /* Checked before the diff: without git there is nothing to compare, and that is the
     one case where skipping is right. Every other failure must be loud. */
  if (git(['rev-parse', 'HEAD']) === null) {
    console.warn('⚠ git unavailable — skipping migration safety check.')
    return null
  }
  return changedMigrationFiles(baseRef)
}

async function main() {
  let files: string[] | null
  try {
    files = await resolveFiles(process.argv.slice(2))
  } catch (error) {
    if (error instanceof BaseRefUnusableError) {
      console.error(`✗ Migration safety check could not run.\n  ${error.message}`)
      process.exit(1)
    }
    throw error
  }
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
