#!/usr/bin/env bun
/**
 * Enforces the project's React Query (TanStack Query v5) conventions.
 *
 * Biome and `check-api-validation-contracts.ts` cover formatting and the
 * raw-fetch / contract boundary. This script catches React-Query-specific
 * anti-patterns that neither covers:
 *
 *   1. missing-stale-time   — useQuery/useInfiniteQuery/useSuspenseQuery without an explicit `staleTime`
 *   2. queryfn-no-signal    — an inline `queryFn` that takes no args (cannot forward the AbortSignal)
 *   3. inline-query-key     — `queryKey: ['literal', ...]` instead of a colocated key factory
 *   4. key-factory-no-root  — a `*Keys` factory in hooks/queries/** without an `all` root key
 *   5. key-fetch-arg-drift  — an identifier the queryFn forwards into the fetch (e.g. `workspaceId`)
 *                             that is absent from the queryKey, so distinct fetch args collide on one
 *                             cache entry. Conservative: only bare camelCase identifiers (never the
 *                             requestJson contract arg, PascalCase/SCREAMING constants, or signal/
 *                             pageParam machinery) are checked, and only when both a queryKey and an
 *                             inline-arrow queryFn with a recognizable call are present.
 *
 * Enforcement model (mirrors check-api-validation-contracts.ts):
 *   - STRICT ZONE (apps/sim/hooks/queries/**): zero tolerance — any violation fails.
 *   - Elsewhere under apps/sim/**: ratcheted against scripts/check-react-query-patterns.baseline.json
 *     (fails only when a category's count rises above the recorded baseline).
 *
 * Escape hatch: put `// rq-lint-allow: <reason>` on the line directly above the
 * flagged construct (up to 3 preceding comment lines tolerated). The reason must
 * be non-empty.
 *
 * Usage:
 *   bun run scripts/check-react-query-patterns.ts            # report
 *   bun run scripts/check-react-query-patterns.ts --check    # CI gate (strict zone + ratchet)
 *   bun run scripts/check-react-query-patterns.ts --update-baseline
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_DIR = path.join(ROOT, 'apps/sim')
const BASELINE_PATH = path.join(ROOT, 'scripts/check-react-query-patterns.baseline.json')

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build'])
const STRICT_PREFIX = 'apps/sim/hooks/queries/'
const ALLOW = 'rq-lint-allow:'

type Category =
  | 'missing-stale-time'
  | 'queryfn-no-signal'
  | 'inline-query-key'
  | 'key-factory-no-root'
  | 'key-fetch-arg-drift'

interface Violation {
  file: string
  line: number
  category: Category
  message: string
  snippet: string
}

const SUGGESTION: Record<Category, string> = {
  'missing-stale-time':
    'add an explicit staleTime (default 0 is rarely correct); e.g. staleTime: 60 * 1000',
  'queryfn-no-signal':
    'destructure the AbortSignal: queryFn: ({ signal }) => fetchX(..., signal) and forward it',
  'inline-query-key':
    'use a colocated hierarchical key factory (entityKeys.list(id)) instead of an inline literal key',
  'key-factory-no-root':
    'every *Keys factory in hooks/queries/** must expose an `all` root key for prefix invalidation',
  'key-fetch-arg-drift':
    'every identifier the queryFn passes to fetch/requestJson must also appear in the queryKey — ' +
    'otherwise distinct fetch args collide on one cache entry (cross-tenant/param cache collision)',
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name))
      out.push(full)
  }
  return out
}

/** Returns the substring of `src` for the balanced bracket group starting at `open` (index of the opening bracket). */
function matchBalanced(src: string, open: number, openCh: string, closeCh: string): string {
  let depth = 0
  let inStr: string | null = null
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    const prev = src[i - 1]
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      continue
    }
    if (ch === openCh) depth++
    else if (ch === closeCh) {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open)
}

function lineAt(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++
  return line
}

/** True if a `// rq-lint-allow: <reason>` annotation sits within the 3 lines above `line` (1-based). */
function hasAllow(lines: string[], line: number): boolean {
  for (let i = line - 2; i >= 0 && i >= line - 5; i--) {
    const text = lines[i]?.trim() ?? ''
    if (text.includes(ALLOW)) {
      const reason = text.slice(text.indexOf(ALLOW) + ALLOW.length).trim()
      return reason.length > 0
    }
    if (text.length > 0 && !text.startsWith('//') && !text.startsWith('*')) break
  }
  return false
}

const QUERY_CALL = /\b(useQuery|useInfiniteQuery|useSuspenseQuery|useSuspenseInfiniteQuery)\s*\(/g
const QUERYFN_NOARG = /queryFn\s*:\s*(?:async\s+)?\(\s*\)\s*=>/
const QUERYFN_PRESENT = /queryFn\s*:/
const INLINE_KEY = /queryKey\s*:\s*\[\s*[`'"]/
const KEYS_FACTORY = /\b(?:export\s+)?const\s+\w*[kK]eys\s*[:=][^=]*?=?\s*\{/g

/**
 * Identifiers that are part of the queryFn machinery (not fetch params) and
 * must never be flagged as drift even though they appear in the call.
 */
const QUERYFN_NOISE = new Set([
  'signal',
  'pageParam',
  'meta',
  'queryKey',
  'direction',
  'client',
  'true',
  'false',
  'null',
  'undefined',
])

/**
 * Extracts the value slice of `key: ...` from an options object, reading up to
 * the property-terminating top-level comma. Nested brackets (arrays, calls, and
 * arrow-function bodies including their own param parens) are skipped via depth
 * tracking, so this correctly returns the whole `({ signal }) => fetchX(...)`
 * arrow for `queryFn`, not just its parameter list.
 */
function extractOptionValue(obj: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*:`, 'g')
  const m = re.exec(obj)
  if (!m) return null
  let i = m.index + m[0].length
  while (i < obj.length && /\s/.test(obj[i])) i++
  let depth = 0
  let inStr: string | null = null
  let j = i
  for (; j < obj.length; j++) {
    const c = obj[j]
    const prev = obj[j - 1]
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) break
  }
  return obj.slice(i, j)
}

/**
 * "key/fetch-arg drift": an identifier the queryFn forwards into the fetch
 * (the args of the first call expression inside the queryFn body) that does NOT
 * textually appear in the queryKey. Conservative — only fires when both the
 * queryKey and an inline-arrow queryFn with a recognizable call are present, and
 * only for bare identifiers (optionally `x as T` / `x!`), never member access,
 * literals, or queryFn machinery (signal/pageParam/etc.).
 */
function findKeyFetchArgDrift(obj: string): string[] {
  const keyExpr = extractOptionValue(obj, 'queryKey')
  const fnExpr = extractOptionValue(obj, 'queryFn')
  if (!keyExpr || !fnExpr) return []

  // Drop the arrow prefix (`async`, `(params) =>`, optional `{ return`) so the
  // search begins at the queryFn body, then locate the first call expression and
  // balance its argument list.
  const bodyStart = /=>\s*(?:\{\s*(?:return\s+)?)?/.exec(fnExpr)
  const body = bodyStart ? fnExpr.slice(bodyStart.index + bodyStart[0].length) : fnExpr
  const call = /(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\(/.exec(body)
  if (!call) return []
  const callee = call[1]
  const openParen = call.index + call[0].length - 1
  const argList = matchBalanced(body, openParen, '(', ')')

  // Split top-level args.
  const args: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 1; i < argList.length - 1; i++) {
    const c = argList[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) {
      args.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim()) args.push(cur)

  // `requestJson(contract, ...)` / `ensureQueryData(contract, ...)` etc. take the
  // contract constant as their first arg — that is module-level config, never a
  // per-hook identifier, so drop it before checking.
  const dropsFirstArg = /(?:^|\.)(requestJson|requestText|ensureQueryData|fetchQuery)$/.test(callee)
  const checkArgs = dropsFirstArg ? args.slice(1) : args

  const drifted: string[] = []
  for (const raw of checkArgs) {
    const id = raw
      .trim()
      .replace(/\s+as\s+[\w$.<>[\]| ]+$/, '')
      .replace(/!+$/, '')
      .trim()
    // Only bare identifiers; skip member access, calls, literals, destructures, spreads.
    if (!/^[A-Za-z_$][\w$]*$/.test(id)) continue
    if (QUERYFN_NOISE.has(id)) continue
    // Skip module-level constants (contracts/config), which are camelCase config
    // ending in `Contract`, PascalCase, or SCREAMING_SNAKE — never hook params.
    if (/Contract$/.test(id) || /^[A-Z]/.test(id) || /^[A-Z0-9_]+$/.test(id)) continue
    // Present in the key (as a whole word) → no drift.
    const inKey = new RegExp(`\\b${id}\\b`).test(keyExpr)
    if (!inKey && !drifted.includes(id)) drifted.push(id)
  }
  return drifted
}

function scanFile(rel: string, content: string): Violation[] {
  const lines = content.split('\n')
  const violations: Violation[] = []
  const add = (index: number, category: Category, snippet: string) => {
    const line = lineAt(content, index)
    if (hasAllow(lines, line)) return
    violations.push({ file: rel, line, category, message: SUGGESTION[category], snippet })
  }

  // 1 & 2: query call objects — staleTime + queryFn signal
  QUERY_CALL.lastIndex = 0
  let m: RegExpExecArray | null = QUERY_CALL.exec(content)
  for (; m !== null; m = QUERY_CALL.exec(content)) {
    const parenStart = m.index + m[0].length - 1
    const arg = matchBalanced(content, parenStart, '(', ')')
    // Only inspect the literal options object form `useQuery({ ... })`.
    const braceRel = arg.indexOf('{')
    if (braceRel === -1) continue
    const obj = matchBalanced(arg, braceRel, '{', '}')
    // Accept both `staleTime: ...` and the shorthand `staleTime,`; skip objects that spread options (...opts).
    if (!/\bstaleTime\b/.test(obj) && !/\.\.\.\w/.test(obj)) {
      add(m.index, 'missing-stale-time', `${m[1]}({ ... }) without staleTime`)
    }
    if (QUERYFN_PRESENT.test(obj) && QUERYFN_NOARG.test(obj)) {
      add(m.index, 'queryfn-no-signal', `${m[1]} queryFn takes no args`)
    }
    for (const id of findKeyFetchArgDrift(obj)) {
      add(
        m.index,
        'key-fetch-arg-drift',
        `${m[1]}: '${id}' passed to fetch but absent from queryKey`
      )
    }
  }

  // 3: inline query keys
  for (let i = 0; i < lines.length; i++) {
    if (INLINE_KEY.test(lines[i])) {
      const line = i + 1
      if (!hasAllow(lines, line)) {
        violations.push({
          file: rel,
          line,
          category: 'inline-query-key',
          message: SUGGESTION['inline-query-key'],
          snippet: lines[i].trim(),
        })
      }
    }
  }

  // 4: key factory must have an `all` root (hooks/queries/** only, excluding util key files that compose others)
  if (rel.startsWith(STRICT_PREFIX)) {
    KEYS_FACTORY.lastIndex = 0
    let k: RegExpExecArray | null = KEYS_FACTORY.exec(content)
    for (; k !== null; k = KEYS_FACTORY.exec(content)) {
      const braceIdx = content.indexOf('{', k.index)
      if (braceIdx === -1) continue
      const obj = matchBalanced(content, braceIdx, '{', '}')
      if (!/\ball\s*:/.test(obj)) {
        add(k.index, 'key-factory-no-root', 'key factory missing `all` root key')
      }
    }
  }

  return violations
}

interface Baseline {
  generatedFrom: string
  counts: Record<string, number>
}

async function loadBaseline(): Promise<Baseline> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
  } catch {
    return { generatedFrom: 'none', counts: {} }
  }
}

async function main() {
  const update = process.argv.includes('--update-baseline')
  const check = process.argv.includes('--check')

  const files = await walk(APP_DIR)
  const all: Violation[] = []
  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const content = await readFile(file, 'utf8')
    if (!/\buse(Query|InfiniteQuery|SuspenseQuery|Mutation)\b|[kK]eys\s*[:=]/.test(content))
      continue
    all.push(...scanFile(rel, content))
  }

  const strict = all.filter((v) => v.file.startsWith(STRICT_PREFIX))
  const ratchet = all.filter((v) => !v.file.startsWith(STRICT_PREFIX))

  const counts: Record<string, number> = {}
  for (const v of ratchet) counts[v.category] = (counts[v.category] ?? 0) + 1

  if (update) {
    const baseline: Baseline = { generatedFrom: 'apps/sim (non-strict zone)', counts }
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`✓ Baseline written: ${JSON.stringify(counts)}`)
    process.exit(0)
  }

  console.log(`React Query pattern audit — scanned ${files.length} files`)
  console.log(`  strict zone (${STRICT_PREFIX}**) violations: ${strict.length}`)
  console.log(`  ratchet zone violations: ${ratchet.length} ${JSON.stringify(counts)}`)

  let failed = false

  if (strict.length > 0) {
    failed = true
    console.error(`\n✗ ${strict.length} violation(s) in the strict zone (${STRICT_PREFIX}**):\n`)
    for (const v of strict) {
      console.error(`  ${v.file}:${v.line}  [${v.category}]`)
      console.error(`    ${v.snippet}`)
      console.error(`    → ${v.message}\n`)
    }
  }

  if (!check && ratchet.length > 0) {
    console.error(`\nRatchet-zone occurrences (not failing without --check):`)
    for (const v of ratchet) {
      console.error(`  ${v.file}:${v.line}  [${v.category}]  ${v.snippet}`)
    }
  }

  if (check) {
    const baseline = await loadBaseline()
    for (const [category, count] of Object.entries(counts)) {
      const base = baseline.counts[category] ?? 0
      if (count > base) {
        failed = true
        console.error(
          `\n✗ ratchet regression: ${category} rose to ${count} (baseline ${base}). ` +
            `Fix the new occurrence(s) or annotate with // ${ALLOW} <reason>.`
        )
        for (const v of ratchet.filter((x) => x.category === category)) {
          console.error(`    ${v.file}:${v.line}  ${v.snippet}`)
        }
      }
    }
  }

  if (failed) process.exit(1)
  console.log('\n✓ React Query pattern audit passed.')
  process.exit(0)
}

main()
