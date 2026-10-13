#!/usr/bin/env bun
/**
 * Ratchets type errors in apps/sim's unit tests down, per file and per error code.
 *
 * `apps/sim/tsconfig.json` excludes `*.test.ts(x)`, so `bun run type-check` never sees the ~3.4k
 * test files, and they carry thousands of type errors nobody is asked to fix today. Without a
 * gate, every new test can add more, and a test whose mocks no longer match the code they stand
 * in for type-checks as fine as one that does. This check runs the native compiler (the root
 * `tsc`, which `check:native-typecheck` pins to TypeScript 7) on `apps/sim/tsconfig.tests.json`,
 * the app's config with the tests left in, counts errors per file and TS code, and compares the
 * counts with `scripts/check-test-types.baseline.json` (`{ file: { "TS2322": n } }`).
 *
 * - A (file, code) count that rises fails, including a file's first error and a new code in a
 *   baselined file, so fixing one error cannot pay for a different kind of error in that file.
 * - A count that drops fails until the baseline is rewritten, so the baseline only shrinks.
 * - Output the parser cannot place (a config error with no file, a compiler crash) fails
 *   outright: it would otherwise read as fewer errors.
 *
 * The key stops at the code on purpose: line and column move with every edit above an error, and
 * messages print types (`Type '{ id: string; … }'`) that change when an unrelated source type or
 * the compiler's type printer does, so either would fail pull requests that added no error.
 *
 * It type-checks the whole app (about a minute on a 4 vCPU runner), so it is not one of the
 * `check:audits`: CI runs it in its own `test-types` job (.github/workflows/checks.yml). Fixing a
 * finding never needs a local run: the failing step prints each new error.
 *
 * Flags:
 * - `--report <dir>` writes `diagnostics.txt` (the compiler's output), `status.json` (its exit
 *   code and how many errors it printed, written only once those agree), and `counts.json` (the
 *   counts, in the baseline's shape) to `<dir>`. CI uploads it as the `test-types` artifact when
 *   the job fails.
 * - `--diagnostics <file>` reads such a `diagnostics.txt` instead of running the compiler, and
 *   requires the `status.json` beside it: an empty or truncated file must never read as fewer
 *   errors, so the parse has to match the recorded exit code and error count.
 * - `--update` rewrites the baseline, refusing to raise any count. A missing baseline is restored
 *   from git, never regenerated.
 *
 * Shrink the baseline after a fix, from a failed CI run's artifact (no local compile):
 *   gh run download <run-id> -n test-types -D <dir>
 *   bun run scripts/check-test-types.ts --diagnostics <dir>/diagnostics.txt --update
 *
 * Run: `bun run check:test-types`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { localBin } from './local-bin'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.join(ROOT, 'apps/sim')
const TSCONFIG = 'tsconfig.tests.json'
const BASELINE = path.join(ROOT, 'scripts/check-test-types.baseline.json')
/** Per regressed (file, code), so one file that stopped resolving an import cannot flood the log. */
const MAX_PRINTED = 25

/** Error count per TS code, per repo-relative file. */
type Counts = Record<string, Record<string, number>>

interface LocatedError {
  code: string
  /** The error's first line, rewritten with its repo-relative path. */
  text: string
}

interface ParsedOutput {
  /** Errors keyed by repo-relative file. */
  errors: Map<string, LocatedError[]>
  /** Top-level lines that are not a located error: a global diagnostic, a crash, a new format. */
  unplaced: string[]
  /** The compiler's own `Found N errors` total, when it printed one. */
  reportedTotal: number | null
}

/** `file(line,col): error TS1234: message`; lazy so a route group's `(name)` stays in the path. */
const LOCATED_ERROR = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const SUMMARY = /^Found (\d+) errors?\b/
const CODE = /^TS\d+$/

/**
 * Parses `tsc --pretty false` output. Paths are resolved against `cwd` (where the compiler ran)
 * and made relative to `root`, so counts match however the compiler printed them. Continuation
 * lines of a multi-line message are indented and belong to the error above them.
 */
export function parseCompilerOutput(output: string, cwd: string, root: string): ParsedOutput {
  const errors = new Map<string, LocatedError[]>()
  const unplaced: string[] = []
  let reportedTotal: number | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '' || /^\s/.test(line)) continue
    const located = LOCATED_ERROR.exec(line)
    if (located) {
      const [, rawFile, row, column, code, message] = located
      const file = path.relative(root, path.resolve(cwd, rawFile)).split(path.sep).join('/')
      const list = errors.get(file) ?? []
      list.push({ code, text: `${file}:${row}:${column} ${code} ${message}` })
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

function sortedKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]])
  )
}

function sortedCounts(counts: Counts): Counts {
  return Object.fromEntries(
    Object.entries(sortedKeys(counts)).map(([file, codes]) => [file, sortedKeys(codes)])
  )
}

export function countErrors(errors: Map<string, LocatedError[]>): Counts {
  const counts: Counts = {}
  for (const [file, list] of errors) {
    const codes: Record<string, number> = {}
    for (const { code } of list) codes[code] = (codes[code] ?? 0) + 1
    counts[file] = codes
  }
  return sortedCounts(counts)
}

function total(counts: Counts): number {
  return Object.values(counts)
    .flatMap((codes) => Object.values(codes))
    .reduce((sum, count) => sum + count, 0)
}

/** Accepts only `{ file: { TSnnnn: positive integer } }` with no empty file entry. */
export function parseCounts(json: string, source: string): Counts {
  const value: unknown = JSON.parse(json)
  if (!isRecordLike(value)) {
    throw new Error(`${source} is not a JSON object of per-file, per-code counts`)
  }
  const counts: Counts = {}
  for (const [file, codes] of Object.entries(value)) {
    if (!isRecordLike(codes) || Object.keys(codes).length === 0) {
      throw new Error(`${source}: ${file} must map TS codes to counts`)
    }
    counts[file] = {}
    for (const [code, count] of Object.entries(codes)) {
      if (!CODE.test(code) || typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        throw new Error(
          `${source}: ${file} ${code} has count ${JSON.stringify(count)}; expected TSnnnn: integer ≥ 1`
        )
      }
      counts[file][code] = count
    }
  }
  return counts
}

interface CountChange {
  file: string
  code: string
  count: number
  baseline: number
}

interface Comparison {
  /** (file, code) pairs above their baseline count, including pairs with no baseline entry. */
  regressed: CountChange[]
  /** Baselined (file, code) pairs below their count, including pairs with no errors left. */
  shrunk: CountChange[]
}

function pairs(counts: Counts): Array<[string, string, number]> {
  return Object.entries(counts).flatMap(([file, codes]) =>
    Object.entries(codes).map(([code, count]): [string, string, number] => [file, code, count])
  )
}

export function compareCounts(current: Counts, baseline: Counts): Comparison {
  const regressed = pairs(current)
    .filter(([file, code, count]) => count > (baseline[file]?.[code] ?? 0))
    .map(([file, code, count]) => ({ file, code, count, baseline: baseline[file]?.[code] ?? 0 }))
  const shrunk = pairs(baseline)
    .filter(([file, code, count]) => (current[file]?.[code] ?? 0) < count)
    .map(([file, code, count]) => ({
      file,
      code,
      count: current[file]?.[code] ?? 0,
      baseline: count,
    }))
  const order = (a: CountChange, b: CountChange) =>
    compareStrings(a.file, b.file) || compareStrings(a.code, b.code)
  return { regressed: regressed.sort(order), shrunk: shrunk.sort(order) }
}

/** Per-(file, code) counts clamped to the baseline, so an update can only lower them. */
export function shrinkBaseline(current: Counts, baseline: Counts): Counts {
  const next: Counts = {}
  for (const [file, code, count] of pairs(current)) {
    const kept = Math.min(count, baseline[file]?.[code] ?? 0)
    if (kept > 0) next[file] = { ...next[file], [code]: kept }
  }
  return sortedCounts(next)
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

/** Fails on any parsed output that would undercount; otherwise returns its counts. */
function checkedCounts(parsed: ParsedOutput): Counts {
  if (parsed.unplaced.length) {
    fail([
      `✗ ${parsed.unplaced.length} line(s) of tsc output are not a located error; fix them first:`,
      ...parsed.unplaced.slice(0, 40).map((line) => `  ${line}`),
    ])
  }
  const counts = countErrors(parsed.errors)
  if (parsed.reportedTotal !== null && parsed.reportedTotal !== total(counts)) {
    fail([`✗ tsc reported ${parsed.reportedTotal} errors but ${total(counts)} were parsed`])
  }
  return counts
}

/** What `--report` records about a compile, so a saved `diagnostics.txt` can be checked later. */
interface CompileStatus {
  exitCode: number
  errorCount: number
}

/** Exit 0 means no errors and 1 or 2 means some; any other pairing is a failed or partial run. */
function checkExitCode(exitCode: number, found: number): void {
  if ((exitCode === 0) !== (found === 0)) {
    fail([`✗ tsc exited with ${exitCode} but ${found} errors were parsed`])
  }
}

/** Runs the compiler on the tests config and returns its parsed output. */
function compile(reportDir: string | null): { counts: Counts; errors: ParsedOutput['errors'] } {
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
  const counts = checkedCounts(parsed)
  checkExitCode(result.exitCode, total(counts))
  if (reportDir) {
    const status: CompileStatus = { exitCode: result.exitCode, errorCount: total(counts) }
    writeFileSync(path.join(reportDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`)
  }
  return { counts, errors: parsed.errors }
}

function readStatus(file: string): CompileStatus {
  if (!existsSync(file)) {
    fail([
      `✗ ${file} is missing, so the compile that wrote these diagnostics cannot be verified.`,
      '  Use the whole test-types artifact of a run whose compile finished.',
    ])
  }
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const { exitCode, errorCount } = toRecord(value)
  if (
    typeof exitCode !== 'number' ||
    ![0, 1, 2].includes(exitCode) ||
    typeof errorCount !== 'number' ||
    !Number.isInteger(errorCount) ||
    errorCount < 0
  ) {
    fail([`✗ ${file} is not { "exitCode": 0 | 1 | 2, "errorCount": integer ≥ 0 }`])
  }
  return { exitCode, errorCount }
}

/**
 * Parses a saved compiler output (the CI artifact's `diagnostics.txt`) without compiling, held
 * to the same checks as a live compile plus the error count recorded beside it.
 */
function readDiagnostics(file: string): { counts: Counts; errors: ParsedOutput['errors'] } {
  const status = readStatus(path.join(path.dirname(file), 'status.json'))
  const parsed = parseCompilerOutput(readFileSync(file, 'utf8'), APP_DIR, ROOT)
  const counts = checkedCounts(parsed)
  checkExitCode(status.exitCode, total(counts))
  if (status.errorCount !== total(counts)) {
    fail([
      `✗ ${file} holds ${total(counts)} errors but its compile printed ${status.errorCount}; ` +
        'it is truncated or from another run.',
    ])
  }
  return { counts, errors: parsed.errors }
}

function main(): void {
  const reportDir = flagValue('--report')
  const diagnosticsFile = flagValue('--diagnostics')
  const update = process.argv.includes('--update')
  if (reportDir) mkdirSync(reportDir, { recursive: true })

  const { counts: current, errors } = diagnosticsFile
    ? readDiagnostics(diagnosticsFile)
    : compile(reportDir)
  if (reportDir) {
    writeFileSync(path.join(reportDir, 'counts.json'), `${JSON.stringify(current, null, 2)}\n`)
  }

  const baselinePath = path.relative(ROOT, BASELINE)
  if (!existsSync(BASELINE)) {
    fail([`✗ ${baselinePath} is missing. Restore it from git.`])
  }
  const baseline = parseCounts(readFileSync(BASELINE, 'utf8'), baselinePath)
  const { regressed, shrunk } = compareCounts(current, baseline)

  if (update) {
    if (regressed.length) {
      fail([
        `✗ refused to raise the baseline for ${regressed.length} (file, code) pair(s); fix them instead:`,
        ...regressed.map((c) => `  ${c.file} ${c.code}: ${c.count} (baseline ${c.baseline})`),
      ])
    }
    const next = shrinkBaseline(current, baseline)
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`Wrote ${baselinePath}: ${total(next)} errors in ${Object.keys(next).length} files`)
    return
  }

  if (regressed.length) {
    console.error(`✗ ${regressed.length} (file, code) pair(s) gained type errors:`)
    for (const change of regressed) {
      console.error(
        `\n  ${change.file} ${change.code}: ${change.count} (baseline ${change.baseline})`
      )
      const lines = (errors.get(change.file) ?? []).filter((error) => error.code === change.code)
      for (const { text } of lines.slice(0, MAX_PRINTED)) console.error(`    ${text}`)
      if (lines.length > MAX_PRINTED) console.error(`    … ${lines.length - MAX_PRINTED} more`)
    }
    console.error(
      '\n  Fix the types: a typed factory from @sim/testing, vi.mocked(fn), or a mock whose shape ' +
        'matches the real module. Never `as any` or a @ts-ignore/@ts-expect-error to quiet one, ' +
        'and never raise the baseline.'
    )
    if (Object.keys(baseline).some((file) => !(file in current))) {
      console.error(
        `  If a regressed file is a baselined file you only moved (git mv), move its entry to the ` +
          `new path in ${baselinePath}; its counts may not grow.`
      )
    }
  }
  if (shrunk.length) {
    console.error(`\n✗ ${shrunk.length} (file, code) pair(s) dropped below the baseline:`)
    for (const change of shrunk) {
      console.error(
        `  ${change.file} ${change.code}: ${change.count} (baseline ${change.baseline})`
      )
    }
    console.error(
      '  Shrink the baseline so they cannot creep back: bun run scripts/check-test-types.ts ' +
        '--update, or without a local compile, from the failed CI run:\n' +
        '  gh run download <run-id> -n test-types -D <dir> && ' +
        'bun run scripts/check-test-types.ts --diagnostics <dir>/diagnostics.txt --update'
    )
  }
  if (regressed.length || shrunk.length) process.exit(1)

  console.log(
    `✓ test type errors: ${total(current)} baselined in ${Object.keys(current).length} files`
  )
}

if (import.meta.main) main()
