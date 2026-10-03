#!/usr/bin/env bun
/**
 * Fails on the two comment patterns that are never documentation:
 *
 * - `banner`: a separator comment — `// ====`, `// --- Section ---`, `// ─── Title ───`,
 *   `/* ------ v2 ------ *\/`. The repo convention is "no separators": structure lives in the
 *   code (modules, functions, TSDoc), and a banner only restates the next declaration's name.
 * - `commented-out-code`: a run of `//` lines whose text parses as TypeScript. Git is the
 *   history; dead code left in a comment rots, misleads readers and agents into thinking it
 *   is a live option, and survives every refactor of the code around it.
 *
 * Both are detected conservatively so a hit is almost always real. Comments are read from the
 * Babel token stream, so `//` inside strings and template literals is never inspected. A
 * commented-out run only counts when it parses with no recovery errors, contains code
 * punctuation, and is not a lone label (`firstRow: bold`), literal, or `a = b` gloss; prose
 * lines inside a comment group split it into separate runs. Change-history phrasing
 * ("previously", "no longer", "used to") was measured and left out: most hits describe live
 * runtime state or a regression a test guards, so it cannot be enforced without false alarms.
 *
 * A legitimate exception (a code sample that must stay a line comment) takes
 * `// comment-hygiene-allow: <reason>` anywhere in the same comment group.
 *
 * The tree was swept clean when this landed (236 banners, 9 commented-out blocks), so there is
 * no baseline: every hit fails.
 *
 * Run: `bun run check:comment-hygiene`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { getErrorMessage } from '@sim/utils/errors'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALLOW = 'comment-hygiene-allow:'

/** Vendored or generated sources whose comments are not ours to edit. */
const EXCLUDED = [/\.d\.ts$/, /(^|\/)bundles\//, /(^|\/)node_modules\//]

export type Rule = 'banner' | 'commented-out-code'

export interface Violation {
  rule: Rule
  line: number
  text: string
}

/** Comment text that opens with a run of separator characters. */
const BANNER = /^(?:={3,}|-{3,}|─{3,}|━{3,}|\*{3,}|~{3,})/

/** At least one token that ordinary prose does not contain. */
const CODE_PUNCTUATION = /[;{}]|=>|\b(?:const|let|return|await|import|export)\s|\w\.\w+\(/

/** Single-line runs must start like a statement or end like a call to count as code. */
const SINGLE_LINE_CODE = /^(?:export|import|const|let|var|return|await|if|for|function)\b|\);?$/

/**
 * A line that reads as prose: a capitalized word followed by more words, without a trailing
 * code delimiter. These split a comment group, so a prose heading above commented-out code
 * does not stop the code from parsing.
 */
const PROSE_LINE = /^[A-Z][\w'-]*(?:\s+[\w'(),./&:—-]+)+\s*$/
const CODE_TAIL = /[;{}]\s*$|[,([]$/

/** Expression kinds that a one-off gloss like `Total = 22` or a bare word would parse as. */
const TRIVIAL_EXPRESSIONS = new Set([
  'TemplateLiteral',
  'StringLiteral',
  'Identifier',
  'NumericLiteral',
  'BinaryExpression',
  'AssignmentExpression',
])

function parsesAsCode(text: string, jsx: boolean): boolean {
  const plugins = jsx ? (['typescript', 'jsx'] as const) : (['typescript'] as const)
  for (const candidate of [text, `[${text}]`, `({${text}})`]) {
    let program
    try {
      program = parse(candidate, {
        sourceType: 'module',
        plugins: [...plugins],
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
      }).program
    } catch {
      continue
    }
    if (candidate !== text) return true
    const trivial = program.body.every(
      (node) =>
        node.type === 'LabeledStatement' ||
        node.type === 'EmptyStatement' ||
        (node.type === 'ExpressionStatement' && TRIVIAL_EXPRESSIONS.has(node.expression.type))
    )
    return !trivial
  }
  return false
}

interface LineComment {
  line: number
  value: string
  ownLine: boolean
}

/** Splits a group of adjacent own-line `//` comments into runs of non-prose lines. */
function codeRuns(group: LineComment[]): LineComment[][] {
  const runs: LineComment[][] = []
  let current: LineComment[] | null = null
  for (const comment of group) {
    const text = comment.value.trim()
    const prose = text.startsWith('//') || (PROSE_LINE.test(text) && !CODE_TAIL.test(text))
    if (!text || prose) {
      current = null
      continue
    }
    if (!current) {
      current = []
      runs.push(current)
    }
    current.push(comment)
  }
  return runs
}

/** Longest run a span search considers; the search is quadratic in run length. */
const MAX_RUN_LINES = 80

function isCode(span: LineComment[], jsx: boolean): boolean {
  const text = span
    .map((comment) => comment.value.replace(/^ /, ''))
    .join('\n')
    .trim()
  if (!CODE_PUNCTUATION.test(text)) return false
  if (span.length === 1 && !SINGLE_LINE_CODE.test(text)) return false
  return parsesAsCode(text, jsx)
}

/**
 * The first contiguous span of a run that parses as code. A run can hold two unrelated
 * snippets back to back (an object, then a type), which only parse separately, so every start
 * line is tried against every end line, longest first.
 */
function firstCodeSpan(run: LineComment[], jsx: boolean): LineComment | undefined {
  const lines = run.slice(0, MAX_RUN_LINES)
  for (let start = 0; start < lines.length; start++) {
    for (let end = lines.length; end > start; end--) {
      if (isCode(lines.slice(start, end), jsx)) return lines[start]
    }
  }
  return undefined
}

/**
 * A superset of every hit: a separator right after a comment opener, or a `//` line holding a
 * {@link CODE_PUNCTUATION} token. Files without one skip the parse, which dominates the run.
 */
const MAY_VIOLATE =
  /\/[/*][*\s]*(?:={3}|-{3}|─{3}|━{3}|\*{3}|~{3})|\/\/[^\n]*(?:[;{}]|=>|\b(?:const|let|return|await|import|export)\b|\w\.\w+\()/

/** Every banner and commented-out-code hit in one source file. */
export function findViolations(file: string, source: string): Violation[] {
  if (!MAY_VIOLATE.test(source)) return []
  const jsx = /\.[jt]sx$/.test(file)
  let comments
  try {
    comments =
      parse(source, {
        sourceType: 'module',
        plugins: ['typescript', ...(jsx ? (['jsx'] as const) : []), 'decorators'],
        errorRecovery: true,
      }).comments ?? []
  } catch (error) {
    throw new Error(`Cannot parse ${file} to check its comments: ${getErrorMessage(error)}`)
  }

  const lines = source.split('\n')
  const violations: Violation[] = []
  const groups: LineComment[][] = []
  let previous: LineComment | undefined

  for (const comment of comments) {
    const line = comment.loc?.start.line ?? 0
    if (comment.type === 'CommentBlock') {
      const singleLine = comment.loc?.start.line === comment.loc?.end.line
      const text = comment.value.replace(/^\*+/, '').trim()
      if (singleLine && BANNER.test(text)) violations.push({ rule: 'banner', line, text })
      previous = undefined
      continue
    }

    const text = comment.value.trim()
    if (BANNER.test(text)) {
      violations.push({ rule: 'banner', line, text })
      previous = undefined
      continue
    }

    const ownLine = /^\s*$/.test(lines[line - 1]?.slice(0, comment.loc?.start.column ?? 0) ?? '')
    const entry = { line, value: comment.value, ownLine }
    if (ownLine && previous?.ownLine && previous.line === line - 1) {
      groups[groups.length - 1].push(entry)
    } else if (ownLine) {
      groups.push([entry])
    }
    previous = entry
  }

  for (const group of groups) {
    if (group.some((comment) => comment.value.includes(ALLOW))) continue
    for (const run of codeRuns(group)) {
      const hit = firstCodeSpan(run, jsx)
      if (hit)
        violations.push({ rule: 'commented-out-code', line: hit.line, text: hit.value.trim() })
    }
  }

  return violations.sort((a, b) => a.line - b.line)
}

function sourceFiles(): string[] {
  return execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '*.ts',
      '*.tsx',
      '*.mts',
      '*.cts',
      '*.mjs',
      '*.cjs',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      // The listing is already ~1 MB, the default execFileSync ceiling.
      maxBuffer: 64 * 1024 * 1024,
    }
  )
    .split('\n')
    .filter((file) => file && !EXCLUDED.some((pattern) => pattern.test(file)))
}

const FIX: Record<Rule, string> = {
  banner:
    'delete the separator; if the title says something the code does not, keep it as a plain ' +
    '`// ...` line or move it into TSDoc on the declaration below',
  'commented-out-code':
    'delete the commented-out code — git keeps the history. If it is a deliberate code sample, ' +
    'put it in a TSDoc `@example` or add `// comment-hygiene-allow: <reason>` to the group',
}

function main(): void {
  const hits: string[] = []
  for (const file of sourceFiles()) {
    let source: string
    try {
      source = readFileSync(path.join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    for (const { rule, line, text } of findViolations(file, source)) {
      hits.push(`✗ ${rule}: ${file}:${line}  // ${text}\n    fix: ${FIX[rule]}`)
    }
  }

  if (hits.length === 0) {
    console.log('✓ comment hygiene (no banners or commented-out code)')
    return
  }
  console.error(hits.join('\n'))
  console.error(
    `\n${hits.length} comment-hygiene violation(s). Comments are TSDoc or a terse inline why — ` +
      'see "Comments" in CLAUDE.md.'
  )
  process.exit(1)
}

if (import.meta.main) main()
