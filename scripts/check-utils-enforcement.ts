#!/usr/bin/env bun
/**
 * Bans inline idioms that a shared helper or a written rule already replaces.
 *
 * Most patterns point at an `@sim/utils` helper (CLAUDE.md "Common utilities"). A few encode
 * render-path rules from `.claude/rules/sim-react-performance.md` and `sim-styling.md` that no
 * linter covers: `useRef(new X())` allocating on every render, and `h-N w-N` where `size-N` is the
 * convention.
 *
 * ES2023 array methods (`toSorted`, `with`, …) throw on Safari/iOS 15, and SWC does not polyfill
 * them. Every tsconfig keeps `lib` at or below ES2022 so `tsc` rejects them at each call site,
 * telling `Array.prototype.with` apart from OpenTelemetry's `context.with` by type; this script
 * fails if a tsconfig raises `lib` past that, which is how they shipped once (#5340). The three
 * names nothing else uses are also matched in source, since tsc accepts them on an `any` receiver.
 *
 * Biome's noRestrictedImports covers the import-based bans it lists — today `nanoid` and
 * `uuid`. It does NOT cover named crypto imports; `import { randomBytes } from 'node:crypto'`
 * passes both gates, and deliberately so, since server code building cipher IVs and tokens
 * wants node's crypto rather than the cross-context wrapper in `@sim/utils/random`.
 *
 * Patterns are matched against the whole file, not line by line: every idiom banned here is a
 * multi-token expression that the formatter wraps at 100 columns, and a line-scoped scan sees
 * none of the wrapped forms. Deliberate exceptions carry `// utils-lint-allow: <reason>`.
 */
import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_DIRS = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'bundles'])

/** `@sim/utils` implements the helpers, so it may use the primitives they replace. */
const UTILS_SOURCE = 'packages/utils/src/'

/** Other files allowed to use the underlying primitives. */
const ALLOWLISTED_FILES = new Set([
  // Published standalone CLIs: `@sim/utils` is private, so they carry local
  // copies rather than a dependency that only resolves inside the monorepo.
  'packages/cli/src/index.ts',
  'packages/ts-sdk/src/index.ts',
  // CJS bundle — cannot use ES module imports
  'apps/sim/lib/execution/isolated-vm-worker.cjs',
  // Emits the sandbox-side event filter as plain JS source, which cannot import @sim/utils
  'apps/sim/executor/handlers/pi/cloud/event-filter-source.ts',
])

/** `s.slice(0, n)` plus a suffix, by `+` or in a template literal; `\1` is `s` and `\2` is `n`. */
const TRUNCATED = String.raw`(?:\`\$\{\1\.(?:slice|substring)\(\s*0\s*,\s*\2\s*\)\}[^\`$]*\`|\1\.(?:slice|substring)\(\s*0\s*,\s*\2\s*\)\s*\+\s*(?:'[^']*'|"[^"]*"|\w+))`
/** Literal gate for both truncate patterns, whose backreferences are slow over every file. */
const TRUNCATE_PREFILTER = /\.(?:slice|substring)\(\s*0\s*,[^)]*\)\s*(?:\}|\+)/

/** Literal gate shared by the `filterUndefined` and `omit` patterns. */
const FROM_ENTRIES = /Object\.fromEntries\(/

const BANNED_PATTERNS: Array<{
  pattern: RegExp
  description: string
  suggestion: string
  /** Cheap literal test that skips the pattern on files that cannot match; memoized per file. */
  prefilter?: RegExp
  /** Bans re-implementing a helper, so `@sim/utils` and the allowlisted files are exempt. */
  replacesHelper?: true
}> = [
  // Randomness / ID generation — global property access that import bans miss
  {
    pattern: /\bMath\.random\s*\(/g,
    description: 'Math.random()',
    suggestion: 'randomInt / randomFloat / randomItem from @sim/utils/random',
    replacesHelper: true,
  },
  {
    pattern: /\bcrypto\.randomUUID\s*\(/g,
    description: 'crypto.randomUUID()',
    suggestion: 'generateId() or generateShortId() from @sim/utils/id',
    replacesHelper: true,
  },
  {
    pattern: /\bcrypto\.randomBytes\s*\(/g,
    description: 'crypto.randomBytes()',
    suggestion: 'generateRandomBytes() or generateRandomHex() from @sim/utils/random',
    replacesHelper: true,
  },
  // Deep clone idiom
  {
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g,
    description: 'JSON.parse(JSON.stringify(...))',
    suggestion: 'structuredClone() — built-in, no import needed',
    replacesHelper: true,
  },
  // Inline error message extraction (excludes null/undefined/false fallbacks — those have different semantics)
  {
    pattern: /instanceof Error\s*\?\s*\w+\.message\s*:\s*(?!\s*null\b|\s*undefined\b|\s*false\b)./g,
    description: 'e instanceof Error ? e.message : fallback',
    suggestion: 'getErrorMessage(e, fallback?) from @sim/utils/errors',
    replacesHelper: true,
  },
  // Inline sleep
  {
    pattern: /new Promise\s*[(<]\s*(?:resolve|\(resolve\))\s*=>\s*setTimeout\s*\(\s*resolve/g,
    description: 'new Promise(resolve => setTimeout(resolve, ms))',
    suggestion: 'sleep(ms) from @sim/utils/helpers',
    replacesHelper: true,
  },
  {
    pattern:
      /\b([\w.]+)\s+instanceof\s+Error\s*\?\s*\1\s*:\s*new\s+Error\(\s*String\(\s*\1\s*\)\s*\)/g,
    description: 'e instanceof Error ? e : new Error(String(e))',
    suggestion: 'toError(e) from @sim/utils/errors',
    prefilter: /new\s+Error\(\s*String\(/,
    replacesHelper: true,
  },
  {
    pattern:
      /typeof\s+([\w.]+)\s*===\s*'object'\s*&&\s*\1\s*!==\s*null\s*&&\s*!Array\.isArray\(\s*\1\s*\)/g,
    description: "typeof v === 'object' && v !== null && !Array.isArray(v)",
    suggestion: 'isRecordLike(v) from @sim/utils/object',
    prefilter: /!Array\.isArray\(/,
    replacesHelper: true,
  },
  {
    pattern:
      /Object\.fromEntries\(\s*Object\.entries\([^()]*\)\s*\.filter\(\s*\(\[\s*\w*\s*,\s*(\w+)\s*\]\)\s*=>\s*\1\s*!==\s*undefined\s*\)\s*,?\s*\)/g,
    description: 'Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))',
    suggestion: 'filterUndefined(obj) from @sim/utils/object',
    prefilter: FROM_ENTRIES,
    replacesHelper: true,
  },
  {
    pattern:
      /Object\.fromEntries\(\s*Object\.entries\([^()]*\)\s*\.filter\(\s*\(\[\s*(\w+)\s*\]\)\s*=>\s*\1\s*!==\s*[\w.'"]+\s*\)\s*,?\s*\)/g,
    description: 'Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))',
    suggestion: 'omit(obj, [key]) from @sim/utils/object',
    prefilter: FROM_ENTRIES,
    replacesHelper: true,
  },
  {
    pattern: new RegExp(
      String.raw`\b([\w.]+)\.length\s*>\s*([\w.]+)\s*\?\s*${TRUNCATED}\s*:\s*\1\b(?!\.)`,
      'g'
    ),
    description: 's.length > n ? s.slice(0, n) + suffix : s',
    prefilter: TRUNCATE_PREFILTER,
    suggestion: "truncate(s, n, suffix?) from @sim/utils/string (suffix defaults to '...')",
    replacesHelper: true,
  },
  {
    pattern: new RegExp(
      String.raw`\b([\w.]+)\.length\s*<=\s*([\w.]+)\s*\?\s*\1\s*:\s*${TRUNCATED}`,
      'g'
    ),
    description: 's.length <= n ? s : s.slice(0, n) + suffix',
    prefilter: TRUNCATE_PREFILTER,
    suggestion: "truncate(s, n, suffix?) from @sim/utils/string (suffix defaults to '...')",
    replacesHelper: true,
  },
  {
    pattern: /\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g/g,
    description: 'hand-rolled regex-metacharacter escape',
    suggestion: 'escapeRegExp(value) from @sim/utils/string',
    replacesHelper: true,
  },
  // Render-path rules (.claude/rules/sim-react-performance.md, sim-styling.md)
  {
    // tsc rejects these under the ES2022 lib, except on an `any` receiver (`JSON.parse(s).toSorted()`).
    pattern: /\.(?:toSorted|toReversed|toSpliced)\s*\(/g,
    description: 'ES2023 array method (throws on Safari/iOS 15; SWC does not polyfill it)',
    suggestion: 'a copy you then mutate: [...arr].sort(), [...arr].reverse(), [...arr].splice()',
  },
  {
    pattern: /\buseRef(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*new\s+[A-Z]\w*/g,
    description: 'useRef(new X()) allocates a throwaway X on every render',
    suggestion: 'useRef<X | null>(null), then `ref.current ??= new X()` before first use',
    prefilter: /useRef/,
  },
  {
    pattern:
      /(?:^|[ \t'"`])((?:[\w-]+:)*)(?:h-(\[[^\]\s]+\]|[\d.]+|px|full|auto|fit|min|max)\s+\1w-\2|w-(\[[^\]\s]+\]|[\d.]+|px|full|auto|fit|min|max)\s+\1h-\3)(?=[\s'"`]|$)/gm,
    prefilter: /[hw]-\S+\s+(?:[\w-]+:)*[hw]-/,
    description: 'h-N w-N with equal N',
    suggestion: 'size-N (Tailwind) — e.g. `size-4`, `size-full`',
  },
]

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, results)
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

interface Violation {
  file: string
  line: number
  description: string
  suggestion: string
  snippet: string
}

/** Escape hatch for a deliberate use, mirroring `rq-lint-allow:` in check-react-query-patterns.ts. */
const ALLOW = 'utils-lint-allow:'

/** Offset of the first character of each line, for mapping a match index back to a line number. */
function buildLineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** 1-based line containing `offset`, by binary search over {@link buildLineStarts}. */
function lineAt(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

/** The line before ends mid-expression: an open bracket, a comma, or a binary/arrow operator. */
const ENDS_OPEN = /(?:[([,=?:+]|=>|&&|\|\||\?\?)$/
/** The line starts mid-expression: a member access, a closing bracket, or a ternary/logical operator. */
const STARTS_CONTINUED = /^(?:[.?:)\]]|&&|\|\|)/

/**
 * True if a `// utils-lint-allow: <reason>` annotation sits just above `line` (1-based).
 *
 * The reason must be non-empty: an annotation that does not say why is the thing this
 * check exists to prevent. A match the formatter wrapped onto a continuation line is first
 * walked up to its statement's first line (the repo omits semicolons, so continuation is
 * read from the bracket or operator at the seam), then up to three comment lines above
 * that are scanned, so the annotation can carry context lines with it.
 */
function hasAllow(lines: string[], line: number): boolean {
  let start = line - 1
  while (start > 0) {
    const previous = lines[start - 1].trim()
    if (!ENDS_OPEN.test(previous) && !STARTS_CONTINUED.test(lines[start].trim())) break
    start--
  }
  for (let i = start - 1; i >= 0 && i >= start - 4; i--) {
    const text = lines[i]?.trim() ?? ''
    if (text.includes(ALLOW)) {
      return text.slice(text.indexOf(ALLOW) + ALLOW.length).trim().length > 0
    }
    if (text.length > 0 && !text.startsWith('//') && !text.startsWith('*')) break
  }
  return false
}

/** A `lib` entry at ES2023 or later, including its sub-libs (`ES2023.Array`) and `ESNext`. */
const LIB_PAST_ES2022 = /^es(?:20(?:2[3-9]|[3-9]\d)|next)\b/i

/** Tracked tsconfigs whose `lib` admits the ES2023 runtime methods `tsc` would otherwise reject. */
function es2023LibViolations(): Violation[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '*tsconfig*.json'], { cwd: ROOT })
  const violations: Violation[] = []
  for (const file of listed.stdout.toString().split('\n').filter(Boolean)) {
    const content = readFileSync(path.join(ROOT, file), 'utf8')
    const lib = /"lib"\s*:\s*\[([^\]]*)\]/.exec(content)
    const entries = lib?.[1]?.match(/"[^"]*"/g) ?? []
    if (!entries.some((entry) => LIB_PAST_ES2022.test(entry.slice(1, -1)))) continue
    const line = content.slice(0, lib?.index).split('\n').length
    violations.push({
      file,
      line,
      description:
        '"lib" past ES2022 lets ES2023 array methods (toSorted, with, …) type-check; they throw on Safari/iOS 15 and SWC does not polyfill them',
      suggestion: '"lib" at ES2022, and a copy in code: [...arr].sort(), [...arr].reverse()',
      snippet: (content.split('\n')[line - 1] ?? '').trim(),
    })
  }
  return violations
}

/** Every banned-pattern hit in one file; `file` is repo-relative, which decides its exemptions. */
export function findViolations(file: string, content: string): Violation[] {
  const violations: Violation[] = []
  const helperSource = file.startsWith(UTILS_SOURCE) || ALLOWLISTED_FILES.has(file)

  const matches: Array<{
    index: number
    description: string
    suggestion: string
  }> = []

  const prefilterHits = new Map<RegExp, boolean>()
  for (const { pattern, description, suggestion, prefilter, replacesHelper } of BANNED_PATTERNS) {
    if (helperSource && replacesHelper) continue
    if (prefilter) {
      let hit = prefilterHits.get(prefilter)
      if (hit === undefined) {
        hit = prefilter.test(content)
        prefilterHits.set(prefilter, hit)
      }
      if (!hit) continue
    }
    pattern.lastIndex = 0
    for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
      matches.push({ index: match.index, description, suggestion })
    }
  }
  if (matches.length === 0) return []

  const lines = content.split('\n')
  const lineStarts = buildLineStarts(content)
  for (const match of matches) {
    const line = lineAt(lineStarts, match.index)
    if (hasAllow(lines, line)) continue
    violations.push({
      file,
      line,
      description: match.description,
      suggestion: match.suggestion,
      snippet: (lines[line - 1] ?? '').trim(),
    })
  }
  return violations
}

async function main() {
  const allFiles: string[] = []
  for (const dir of SCAN_DIRS) {
    await walk(dir, allFiles)
  }

  const violations: Violation[] = []

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file)
    violations.push(...findViolations(rel, await readFile(file, 'utf8')))
  }

  violations.push(...es2023LibViolations())

  if (violations.length === 0) {
    console.log('✓ No banned patterns found.')
    process.exit(0)
  }

  console.error(`\nFound ${violations.length} banned pattern(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ✗ ${v.description} → use ${v.suggestion}`)
    console.error(`    ${v.snippet}\n`)
  }
  process.exit(1)
}

if (import.meta.main) main()
