#!/usr/bin/env bun
/**
 * Bans inline idioms that a shared helper or a written rule already replaces.
 *
 * Most patterns point at an `@sim/utils` helper (CLAUDE.md "Common utilities"). A few encode
 * render-path rules from `.claude/rules/sim-react-performance.md` and `sim-styling.md` that no
 * linter covers: ES2023 array methods that Safari 15 lacks (banned everywhere, since whether a
 * module reaches the browser is not visible from its path and a copy-then-sort costs the same), `useRef(new X())` allocating on
 * every render, and `h-N w-N` where `size-N` is the convention.
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
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { getErrorMessage } from '@sim/utils/errors'

const ROOT = path.resolve(import.meta.dir, '..')

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
  // Uses crypto.getRandomValues() directly (not crypto.randomUUID) — TSDoc comment triggers false positive
  'packages/testing/src/factories/id.ts',
])

/** `s.slice(0, n)` plus a suffix, by `+` or in a template literal; `\1` is `s` and `\2` is `n`. */
const TRUNCATED = String.raw`(?:\`\$\{\1\.(?:slice|substring)\(\s*0\s*,\s*\2\s*\)\}[^\`$]*\`|\1\.(?:slice|substring)\(\s*0\s*,\s*\2\s*\)\s*\+\s*(?:'[^']*'|"[^"]*"|\w+))`
/** Literal gate for both truncate patterns, whose backreferences are slow over every file. */
const TRUNCATE_PREFILTER = /\.(?:slice|substring)\(\s*0\s*,[^)]*\)\s*(?:\}|\+)/

/** Literal gate shared by the `filterUndefined` and `omit` patterns. */
const FROM_ENTRIES = /Object\.fromEntries\(/

/** Shared by the toSorted/toReversed/toSpliced pattern and the AST-based `.with` check. */
const ES2023_ARRAY_METHOD = {
  description:
    'ES2023 array method (throws on Safari/iOS 15 wherever the module reaches the browser)',
  suggestion:
    'a copy you then mutate: [...arr].sort(), [...arr].reverse(), [...arr].splice(), or [...arr] then next[i] = value',
}

const BANNED_PATTERNS: Array<{
  pattern: RegExp
  description: string
  suggestion: string
  /** Cheap literal test that skips the pattern on files that cannot match; memoized per file. */
  prefilter?: RegExp
}> = [
  // Randomness / ID generation — global property access that import bans miss
  {
    pattern: /\bMath\.random\s*\(/g,
    description: 'Math.random()',
    suggestion: 'randomInt / randomFloat / randomItem from @sim/utils/random',
  },
  {
    pattern: /\bcrypto\.randomUUID\s*\(/g,
    description: 'crypto.randomUUID()',
    suggestion: 'generateId() or generateShortId() from @sim/utils/id',
  },
  {
    pattern: /\bcrypto\.randomBytes\s*\(/g,
    description: 'crypto.randomBytes()',
    suggestion: 'generateRandomBytes() or generateRandomHex() from @sim/utils/random',
  },
  // Deep clone idiom
  {
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g,
    description: 'JSON.parse(JSON.stringify(...))',
    suggestion: 'structuredClone() — built-in, no import needed',
  },
  // Inline error message extraction (excludes null/undefined/false fallbacks — those have different semantics)
  {
    pattern: /instanceof Error\s*\?\s*\w+\.message\s*:\s*(?!\s*null\b|\s*undefined\b|\s*false\b)./g,
    description: 'e instanceof Error ? e.message : fallback',
    suggestion: 'getErrorMessage(e, fallback?) from @sim/utils/errors',
  },
  // Inline sleep
  {
    pattern: /new Promise\s*[(<]\s*(?:resolve|\(resolve\))\s*=>\s*setTimeout\s*\(\s*resolve/g,
    description: 'new Promise(resolve => setTimeout(resolve, ms))',
    suggestion: 'sleep(ms) from @sim/utils/helpers',
  },
  {
    pattern:
      /\b([\w.]+)\s+instanceof\s+Error\s*\?\s*\1\s*:\s*new\s+Error\(\s*String\(\s*\1\s*\)\s*\)/g,
    description: 'e instanceof Error ? e : new Error(String(e))',
    suggestion: 'toError(e) from @sim/utils/errors',
    prefilter: /new\s+Error\(\s*String\(/,
  },
  {
    pattern:
      /typeof\s+([\w.]+)\s*===\s*'object'\s*&&\s*\1\s*!==\s*null\s*&&\s*!Array\.isArray\(\s*\1\s*\)/g,
    description: "typeof v === 'object' && v !== null && !Array.isArray(v)",
    suggestion: 'isRecordLike(v) from @sim/utils/object',
    prefilter: /!Array\.isArray\(/,
  },
  {
    pattern:
      /Object\.fromEntries\(\s*Object\.entries\([^()]*\)\s*\.filter\(\s*\(\[\s*\w*\s*,\s*(\w+)\s*\]\)\s*=>\s*\1\s*!==\s*undefined\s*\)\s*,?\s*\)/g,
    description: 'Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))',
    suggestion: 'filterUndefined(obj) from @sim/utils/object',
    prefilter: FROM_ENTRIES,
  },
  {
    pattern:
      /Object\.fromEntries\(\s*Object\.entries\([^()]*\)\s*\.filter\(\s*\(\[\s*(\w+)\s*\]\)\s*=>\s*\1\s*!==\s*[\w.'"]+\s*\)\s*,?\s*\)/g,
    description: 'Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))',
    suggestion: 'omit(obj, [key]) from @sim/utils/object',
    prefilter: FROM_ENTRIES,
  },
  {
    pattern: new RegExp(
      String.raw`\b([\w.]+)\.length\s*>\s*([\w.]+)\s*\?\s*${TRUNCATED}\s*:\s*\1\b(?!\.)`,
      'g'
    ),
    description: 's.length > n ? s.slice(0, n) + suffix : s',
    prefilter: TRUNCATE_PREFILTER,
    suggestion: "truncate(s, n, suffix?) from @sim/utils/string (suffix defaults to '...')",
  },
  {
    pattern: new RegExp(
      String.raw`\b([\w.]+)\.length\s*<=\s*([\w.]+)\s*\?\s*\1\s*:\s*${TRUNCATED}`,
      'g'
    ),
    description: 's.length <= n ? s : s.slice(0, n) + suffix',
    prefilter: TRUNCATE_PREFILTER,
    suggestion: "truncate(s, n, suffix?) from @sim/utils/string (suffix defaults to '...')",
  },
  {
    pattern: /\/\[\.\*\+\?\^\$\{\}\(\)\|\[\\\]\\\\\]\/g/g,
    description: 'hand-rolled regex-metacharacter escape',
    suggestion: 'escapeRegExp(value) from @sim/utils/string',
  },
  // Render-path rules (.claude/rules/sim-react-performance.md, sim-styling.md)
  {
    pattern: /\.(?:toSorted|toReversed|toSpliced)\s*\(/g,
    ...ES2023_ARRAY_METHOD,
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

/** Cheap gate: only files that contain a `.with(` call are parsed. */
const WITH_CALL = /\.with\s*\(/

/** OpenTelemetry's `context.with(ctx, fn)` shares the shape; its receivers are named for the context API. */
const OTEL_CONTEXT_RECEIVER = /context/i

/** A Babel AST node, read structurally rather than through `@babel/types`. */
interface SyntaxNode extends Record<string, unknown> {
  type: string
  start: number
}

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

function walkNodes(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node)
  for (const value of Object.values(node)) {
    if (isSyntaxNode(value)) walkNodes(value, visit)
    else if (Array.isArray(value))
      for (const item of value) if (isSyntaxNode(item)) walkNodes(item, visit)
  }
}

/** The name a member call is made on: `arr` in `arr.with(…)`, `items` in `this.items.with(…)`. */
function receiverName(receiver: unknown): string | undefined {
  if (!isSyntaxNode(receiver)) return undefined
  if (receiver.type === 'Identifier' && typeof receiver.name === 'string') return receiver.name
  const isMember =
    receiver.type === 'MemberExpression' || receiver.type === 'OptionalMemberExpression'
  if (!isMember || receiver.computed === true || !isSyntaxNode(receiver.property)) return undefined
  return typeof receiver.property.name === 'string' ? receiver.property.name : undefined
}

/**
 * Offsets of every `Array.prototype.with(index, value)` call: a two-argument `.with` on any
 * receiver except an OpenTelemetry context object. Drizzle's one-argument `.with(cte)` and
 * `index().with({ … })` never match.
 */
function findArrayWithCalls(file: string, content: string): number[] {
  let program: unknown
  try {
    program = parse(content, {
      sourceType: 'module',
      plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? (['jsx'] as const) : [])],
      errorRecovery: true,
    }).program
  } catch (error) {
    throw new Error(`Cannot parse ${file} to check its .with calls: ${getErrorMessage(error)}`)
  }
  if (!isSyntaxNode(program)) return []

  const offsets: number[] = []
  walkNodes(program, (node) => {
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return
    if (!Array.isArray(node.arguments) || node.arguments.length !== 2) return
    const callee = node.callee
    if (!isSyntaxNode(callee) || callee.computed === true || !isSyntaxNode(callee.property)) return
    if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return
    if (callee.property.name !== 'with') return
    if (OTEL_CONTEXT_RECEIVER.test(receiverName(callee.object) ?? '')) return
    offsets.push(callee.property.start)
  })
  return offsets
}

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

async function main() {
  const allFiles: string[] = []
  for (const dir of SCAN_DIRS) {
    await walk(dir, allFiles)
  }

  const violations: Violation[] = []

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file)
    if (rel.startsWith(UTILS_SOURCE) || ALLOWLISTED_FILES.has(rel)) continue

    const content = await readFile(file, 'utf8')
    const matches: Array<{
      index: number
      description: string
      suggestion: string
    }> = []

    const prefilterHits = new Map<RegExp, boolean>()
    for (const { pattern, description, suggestion, prefilter } of BANNED_PATTERNS) {
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
    if (WITH_CALL.test(content)) {
      for (const index of findArrayWithCalls(rel, content)) {
        matches.push({ index, ...ES2023_ARRAY_METHOD })
      }
    }
    if (matches.length === 0) continue

    const lines = content.split('\n')
    const lineStarts = buildLineStarts(content)
    for (const match of matches) {
      const line = lineAt(lineStarts, match.index)
      if (hasAllow(lines, line)) continue
      violations.push({
        file: rel,
        line,
        description: match.description,
        suggestion: match.suggestion,
        snippet: (lines[line - 1] ?? '').trim(),
      })
    }
  }

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

main()
