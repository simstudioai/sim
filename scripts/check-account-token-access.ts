#!/usr/bin/env bun
/**
 * Audits that the `account` table's OAuth token columns are only ever read or written
 * through the one module that knows how to encrypt and decrypt them.
 *
 * Three shapes are flagged:
 *
 *   1. Naming a token column directly (`account.accessToken`, `schema.account.idToken`).
 *   2. Selecting the whole row without a projection — `db.select().from(account)` or
 *      `db.query.account.findFirst(...)`. This is the subtler one: it pulls all three
 *      token columns implicitly, so a site that only wants `userId` today silently starts
 *      leaking ciphertext the moment someone reads `.accessToken` off the result.
 *   3. Writing to the table at all — `db.insert(account)` / `db.update(account)`. A new
 *      connect flow copied from an old one is how a plaintext token gets stored, and no
 *      read-side rule would catch it. Writes go through `upsertProviderAccountTokens`.
 *
 * Escape hatch: `// account-token-access-allow: <reason>` on one of the three lines above
 * the offending line. The reason is mandatory.
 *
 * Scope is `apps/sim`. `scripts/backfill-account-token-encryption.ts` writes these columns
 * directly by design — bulk enveloping is the one job that cannot go through the accessor —
 * and is reviewed as a maintenance tool rather than application code.
 *
 * Run: `bun run check:account-token-access`
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const APP = resolve(ROOT, 'apps/sim')

/**
 * The modules permitted to touch the token columns. Each either implements the envelope or
 * immediately decrypts what it selects.
 *
 * Keep this list short — its purpose is to stop a *new*, silent token read appearing anywhere
 * in the other ~4,000 files.
 */
const TOKEN_AWARE_MODULES = new Set([
  'apps/sim/lib/oauth/account-token-crypto.ts',
  'apps/sim/lib/oauth/account-tokens.ts',
  'apps/sim/lib/oauth/credential-service.ts',
  'apps/sim/lib/oauth/slack.ts',
])

const ANNOTATION = 'account-token-access-allow:'
const MAX_ANNOTATION_LOOKBACK = 3

/**
 * Matched against the whole file rather than line by line: the formatter breaks any chain
 * past the print width, so `db.select().from(account)` is normally written across three
 * lines and a per-line scan would never see it. `\s` spans newlines, so one pass over the
 * source catches both shapes.
 */
const RULES: ReadonlyArray<{ kind: FindingKind; pattern: RegExp }> = [
  {
    kind: 'token-column',
    pattern: /\b(?:schema\.)?account\.(?:accessToken|refreshToken|idToken)\b/g,
  },
  {
    kind: 'star-select',
    pattern: /\bdb\s*\.\s*select\s*\(\s*\)\s*\.\s*from\s*\(\s*(?:schema\.)?account\s*\)/g,
  },
  { kind: 'relational-read', pattern: /\bdb\s*\.\s*query\s*\.\s*account\s*\.\s*find/g },
  { kind: 'write', pattern: /\.\s*(?:insert|update)\s*\(\s*(?:schema\.)?account\s*\)/g },
]

export type FindingKind =
  | 'token-column'
  | 'star-select'
  | 'relational-read'
  | 'write'
  | 'empty-reason'

export interface Finding {
  file: string
  line: number
  kind: FindingKind
  text: string
}

const MESSAGES: Record<FindingKind, string> = {
  'token-column': 'reads or writes an account token column directly',
  'star-select': 'selects the whole account row, which implicitly pulls all three token columns',
  'relational-read':
    'reads the account row through the relational API, which implicitly pulls all three token columns',
  write:
    'writes to the account table directly, so a token column could be stored without encryption',
  'empty-reason': `\`${ANNOTATION}\` annotation has no reason`,
}

/**
 * True when an `account-token-access-allow:` annotation with a non-empty reason sits within
 * the preceding comment block. Scanning stops at the first non-empty, non-comment line so an
 * annotation cannot leak downward past unrelated code.
 */
function findAnnotation(lines: string[], index: number): 'present' | 'empty-reason' | 'absent' {
  for (let i = index - 1; i >= 0 && i >= index - MAX_ANNOTATION_LOOKBACK; i--) {
    const line = lines[i]?.trim() ?? ''
    if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
      if (!line.includes(ANNOTATION)) continue
      const reason = line.split(ANNOTATION)[1]?.trim() ?? ''
      return reason.length > 0 ? 'present' : 'empty-reason'
    }
    break
  }
  return 'absent'
}

/** Analyzes one file's source. Exported so the audit is unit-testable without a tree walk. */
export function auditSource(relPath: string, source: string): Finding[] {
  if (TOKEN_AWARE_MODULES.has(relPath)) return []
  if (!source.includes('account')) return []

  const lines = source.split('\n')
  /** Offset of the first character of each line, so a match index maps back to a line. */
  const lineStarts: number[] = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1)
  }

  const lineIndexAt = (offset: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (lineStarts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return low
  }

  /** One finding per line: a single statement should not be reported by several rules. */
  const byLine = new Map<number, Finding>()

  for (const { kind, pattern } of RULES) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      const index = lineIndexAt(match.index)
      if (byLine.has(index)) continue

      const annotation = findAnnotation(lines, index)
      if (annotation === 'present') continue

      byLine.set(index, {
        file: relPath,
        line: index + 1,
        kind: annotation === 'empty-reason' ? 'empty-reason' : kind,
        text: (lines[index] ?? '').trim(),
      })
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'generated'])

function walk(directory: string, into: string[]): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) walk(full, into)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) into.push(full)
  }
  return into
}

function main(): void {
  const files = walk(APP, [])
  const findings: Finding[] = []
  for (const file of files) {
    const relPath = relative(ROOT, file)
    findings.push(...auditSource(relPath, readFileSync(file, 'utf8')))
  }

  if (findings.length > 0) {
    console.error('\n❌ account token columns accessed outside the token accessor\n')
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  ${MESSAGES[finding.kind]}`)
      console.error(`    ${finding.text}`)
    }
    console.error(
      `\n  fix: read and write tokens through \`@/lib/oauth/account-tokens\`, or project only the\n` +
        `       non-token columns you need (\`select({ id, userId })\`). For a documented exception,\n` +
        `       add \`// ${ANNOTATION} <reason>\` directly above the line.\n`
    )
    process.exit(1)
  }

  console.log(`✓ account token columns are only accessed via the accessor (${files.length} files)`)
}

if (import.meta.main) main()
