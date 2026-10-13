#!/usr/bin/env bun
/**
 * Ratchets type errors in apps/sim's unit tests down, file by file.
 *
 * `apps/sim/tsconfig.json` excludes `*.test.ts(x)`, so `bun run type-check` never sees the ~3.4k
 * test files, and they carry thousands of type errors nobody is asked to fix today. Without a
 * gate, every new test can add more, and a test whose mocks no longer match the code they stand
 * in for type-checks as fine as one that does. This check runs the native compiler (the root
 * `tsc`, which `check:native-typecheck` pins to TypeScript 7) on `apps/sim/tsconfig.tests.json`,
 * the app's config with the tests left in, counts errors per file, and compares the counts with
 * `scripts/check-test-types.baseline.json`.
 *
 * - A file whose count rises, or a file that gains its first error, fails.
 * - A file whose count drops fails until the baseline is rewritten, so the baseline only shrinks
 *   and a fix cannot be silently spent on a new error elsewhere in the same file.
 * - Output the parser cannot place (a config error with no file, a compiler crash) fails
 *   outright: it would otherwise read as fewer errors.
 *
 * It type-checks the whole app (about a minute on a 4 vCPU runner), so it is not one of the
 * `check:audits`: CI runs it in its own `test-types` job (.github/workflows/checks.yml). Fixing a
 * finding never needs a local run: the failing step prints each new error.
 *
 * Flags:
 * - `--report <dir>` writes `diagnostics.txt` (the compiler's output) and `counts.json` (the
 *   per-file counts, in the baseline's shape) to `<dir>`. CI uploads it as the `test-types`
 *   artifact when the job fails.
 * - `--counts <file>` reads the counts from such a `counts.json` instead of running the compiler.
 * - `--update` rewrites the baseline, refusing to raise any count.
 * - `--update --init` creates a missing baseline from the current counts.
 *
 * Shrink the baseline after a fix, from a failed CI run's artifact (no local compile):
 *   gh run download <run-id> -n test-types -D <dir>
 *   bun run scripts/check-test-types.ts --counts <dir>/counts.json --update
 *
 * Run: `bun run check:test-types`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { localBin } from './local-bin'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.join(ROOT, 'apps/sim')
const TSCONFIG = 'tsconfig.tests.json'
const BASELINE = path.join(ROOT, 'scripts/check-test-types.baseline.json')
/** Per regressed file, so one file that stopped resolving an import cannot flood the log. */
const MAX_PRINTED_PER_FILE = 25

/** Error count per repo-relative file. */
type Counts = Record<string, number>

interface ParsedOutput {
  /** Each error's first line, rewritten with its repo-relative path, keyed by that path. */
  errors: Map<string, string[]>
  /** Top-level lines that are not a located error: a global diagnostic, a crash, a new format. */
  unplaced: string[]
  /** The compiler's own `Found N errors` total, when it printed one. */
  reportedTotal: number | null
}

/** `file(line,col): error TS1234: message`; lazy so a route group's `(name)` stays in the path. */
const LOCATED_ERROR = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const SUMMARY = /^Found (\d+) errors?\b/

/**
 * Parses `tsc --pretty false` output. Paths are resolved against `cwd` (where the compiler ran)
 * and made relative to `root`, so counts match however the compiler printed them. Continuation
 * lines of a multi-line message are indented and belong to the error above them.
 */
export function parseCompilerOutput(output: string, cwd: string, root: string): ParsedOutput {
  const errors = new Map<string, string[]>()
  const unplaced: string[] = []
  let reportedTotal: number | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '' || /^\s/.test(line)) continue
    const located = LOCATED_ERROR.exec(line)
    if (located) {
      const [, rawFile, row, column, code, message] = located
      const file = path.relative(root, path.resolve(cwd, rawFile)).split(path.sep).join('/')
      const list = errors.get(file) ?? []
      list.push(`${file}:${row}:${column} ${code} ${message}`)
      errors.set(file, list)
      continue
    }
    const summary = SUMMARY.exec(line)
    if (summary) {
      reportedTotal = Number(summary[1])
      continue
    }
    unplaced.push(line)
  }
  return { errors, unplaced, reportedTotal }
}

function sortedCounts(counts: Counts): Counts {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((file) => [file, counts[file]])
  )
}

export function countErrors(errors: Map<string, string[]>): Counts {
  return sortedCounts(Object.fromEntries([...errors].map(([file, lines]) => [file, lines.length])))
}

function total(counts: Counts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

/** Accepts only a JSON object of positive integer counts: the baseline's and the report's shape. */
export function parseCounts(json: string, source: string): Counts {
  const value: unknown = JSON.parse(json)
  if (!isRecordLike(value)) {
    throw new Error(`${source} is not a JSON object of per-file counts`)
  }
  const counts: Counts = {}
  for (const [file, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new Error(
        `${source}: ${file} has count ${JSON.stringify(count)}; expected an integer ≥ 1`
      )
    }
    counts[file] = count
  }
  return counts
}

interface CountChange {
  file: string
  count: number
  baseline: number
}

interface Comparison {
  /** Files above their baseline count, including files with no baseline entry. */
  regressed: CountChange[]
  /** Baselined files below their count, including files with no errors left. */
  shrunk: CountChange[]
}

export function compareCounts(current: Counts, baseline: Counts): Comparison {
  const regressed = Object.entries(current)
    .filter(([file, count]) => count > (baseline[file] ?? 0))
    .map(([file, count]) => ({ file, count, baseline: baseline[file] ?? 0 }))
  const shrunk = Object.entries(baseline)
    .filter(([file, count]) => (current[file] ?? 0) < count)
    .map(([file, count]) => ({ file, count: current[file] ?? 0, baseline: count }))
  const byFile = (a: CountChange, b: CountChange) => compareStrings(a.file, b.file)
  return { regressed: regressed.sort(byFile), shrunk: shrunk.sort(byFile) }
}

/** Per-file counts clamped to the baseline, so an update can only lower them. */
export function shrinkBaseline(current: Counts, baseline: Counts): Counts {
  return sortedCounts(
    Object.fromEntries(
      Object.entries(current)
        .map(([file, count]): [string, number] => [file, Math.min(count, baseline[file] ?? 0)])
        .filter(([, count]) => count > 0)
    )
  )
}

function flagValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`✗ ${flag} needs a path`)
    process.exit(1)
  }
  return path.resolve(value)
}

function fail(lines: string[]): never {
  for (const line of lines) console.error(line)
  process.exit(1)
}

/** Runs the compiler and returns its errors, failing on any output that would undercount. */
function compile(reportDir: string | null): { counts: Counts; errors: Map<string, string[]> } {
  const result = Bun.spawnSync([localBin('tsc'), '--noEmit', '--pretty', 'false', '-p', TSCONFIG], {
    cwd: APP_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (reportDir) writeFileSync(path.join(reportDir, 'diagnostics.txt'), `${stdout}${stderr}`)

  // 0: no errors; 1 and 2: errors reported. Anything else, or a signal, is a crash.
  if (result.signalCode || ![0, 1, 2].includes(result.exitCode)) {
    fail([
      `✗ tsc exited with ${result.signalCode ? `signal ${result.signalCode}` : result.exitCode}:`,
      stderr.trim() || stdout.trim().split('\n').slice(-40).join('\n'),
    ])
  }
  const parsed = parseCompilerOutput(stdout, APP_DIR, ROOT)
  if (parsed.unplaced.length) {
    fail([
      `✗ ${parsed.unplaced.length} line(s) of tsc output are not a located error; fix them first:`,
      ...parsed.unplaced.slice(0, 40).map((line) => `  ${line}`),
    ])
  }
  const counts = countErrors(parsed.errors)
  const found = total(counts)
  if (parsed.reportedTotal !== null && parsed.reportedTotal !== found) {
    fail([`✗ tsc reported ${parsed.reportedTotal} errors but ${found} were parsed`])
  }
  if ((result.exitCode === 0) !== (found === 0)) {
    fail([`✗ tsc exited with ${result.exitCode} but ${found} errors were parsed`])
  }
  return { counts, errors: parsed.errors }
}

function main(): void {
  const reportDir = flagValue('--report')
  const countsFile = flagValue('--counts')
  const update = process.argv.includes('--update')
  if (reportDir) mkdirSync(reportDir, { recursive: true })

  const { counts: current, errors } = countsFile
    ? {
        counts: sortedCounts(parseCounts(readFileSync(countsFile, 'utf8'), countsFile)),
        errors: new Map<string, string[]>(),
      }
    : compile(reportDir)
  if (reportDir) {
    writeFileSync(path.join(reportDir, 'counts.json'), `${JSON.stringify(current, null, 2)}\n`)
  }

  const baselinePath = path.relative(ROOT, BASELINE)
  if (!existsSync(BASELINE)) {
    if (update && process.argv.includes('--init')) {
      writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
      console.log(
        `Created ${baselinePath}: ${total(current)} errors in ${Object.keys(current).length} files`
      )
      return
    }
    fail([
      `✗ ${baselinePath} is missing. Restore it from git; create a new one only with --update --init.`,
      '  Without a local compile: take counts.json from the failed `test-types` CI job',
      '  (gh run download <run-id> -n test-types -D <dir>), then',
      '  bun run scripts/check-test-types.ts --counts <dir>/counts.json --update --init',
    ])
  }
  const baseline = parseCounts(readFileSync(BASELINE, 'utf8'), baselinePath)
  const { regressed, shrunk } = compareCounts(current, baseline)

  if (update) {
    if (regressed.length) {
      fail([
        `✗ refused to raise the baseline for ${regressed.length} file(s); fix them instead:`,
        ...regressed.map((c) => `  ${c.file}: ${c.count} (baseline ${c.baseline})`),
      ])
    }
    const next = shrinkBaseline(current, baseline)
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`Wrote ${baselinePath}: ${total(next)} errors in ${Object.keys(next).length} files`)
    return
  }

  if (regressed.length) {
    console.error(`✗ ${regressed.length} test file(s) gained type errors:`)
    for (const change of regressed) {
      console.error(`\n  ${change.file}: ${change.count} (baseline ${change.baseline})`)
      const lines = errors.get(change.file) ?? []
      for (const line of lines.slice(0, MAX_PRINTED_PER_FILE)) console.error(`    ${line}`)
      if (lines.length > MAX_PRINTED_PER_FILE) {
        console.error(`    … ${lines.length - MAX_PRINTED_PER_FILE} more`)
      }
    }
    console.error(
      '\n  Fix the types: a typed factory from @sim/testing, vi.mocked(fn), or a mock whose shape ' +
        'matches the real module. Never `as any` or a @ts-ignore/@ts-expect-error to quiet one, ' +
        'and never raise the baseline.'
    )
    if (shrunk.some((change) => change.count === 0)) {
      console.error(
        `  If a regressed file is a baselined file you only moved (git mv), move its entry to the ` +
          `new path in ${baselinePath}; its count may not grow.`
      )
    }
  }
  if (shrunk.length) {
    console.error(`\n✗ ${shrunk.length} file(s) dropped below the baseline:`)
    for (const change of shrunk) {
      console.error(`  ${change.file}: ${change.count} (baseline ${change.baseline})`)
    }
    console.error(
      '  Shrink the baseline so they cannot creep back: bun run scripts/check-test-types.ts ' +
        '--update, or without a local compile, from the failed CI run:\n' +
        '  gh run download <run-id> -n test-types -D <dir> && ' +
        'bun run scripts/check-test-types.ts --counts <dir>/counts.json --update'
    )
  }
  if (regressed.length || shrunk.length) process.exit(1)

  console.log(
    `✓ test type errors: ${total(current)} baselined in ${Object.keys(current).length} files`
  )
}

if (import.meta.main) main()
