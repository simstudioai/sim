import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  compareCounts,
  countErrors,
  parseCompilerOutput,
  parseCounts,
  shrinkBaseline,
} from '@scripts/check-test-types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = '/repo'
const APP = '/repo/apps/sim'

function counts(output: string) {
  return countErrors(parseCompilerOutput(output, APP, ROOT).errors)
}

describe('parseCompilerOutput', () => {
  it.each([
    {
      name: 'a route group and a dynamic segment stay in the path',
      output: "app/(landing)/[slug]/page.test.tsx(12,3): error TS2322: Type 'a' is not 'b'.",
      expected: { 'apps/sim/app/(landing)/[slug]/page.test.tsx': { TS2322: 1 } },
    },
    {
      name: 'a file outside the app resolves against where tsc ran',
      output: '../../packages/testing/src/mocks/db.ts(4,1): error TS2307: Cannot find module.',
      expected: { 'packages/testing/src/mocks/db.ts': { TS2307: 1 } },
    },
    {
      name: 'an absolute path is made repo-relative',
      output: '/repo/apps/sim/lib/a.test.ts(1,1): error TS2345: Bad argument.',
      expected: { 'apps/sim/lib/a.test.ts': { TS2345: 1 } },
    },
    {
      name: 'indented continuation lines belong to the error above, and codes count apart',
      output: [
        "lib/a.test.ts(3,5): error TS2322: Type '{ a: 1 }' is not assignable to type 'B'.",
        "  Property 'b' is missing in type '{ a: 1 }' but required in type 'B'.",
        '    lib/b.ts(9,2): error TS2322: quoted inside a message chain',
        'lib/a.test.ts(8,1): error TS2554: Expected 1 arguments, but got 0.',
        'lib/a.test.ts(9,1): error TS2554: Expected 1 arguments, but got 0.',
      ].join('\n'),
      expected: { 'apps/sim/lib/a.test.ts': { TS2322: 1, TS2554: 2 } },
    },
    {
      name: 'CRLF output and blank lines',
      output: 'lib/a.test.ts(1,1): error TS1: x\r\n\r\nlib/b.test.ts(2,2): error TS2: y\r\n',
      expected: { 'apps/sim/lib/a.test.ts': { TS1: 1 }, 'apps/sim/lib/b.test.ts': { TS2: 1 } },
    },
    {
      name: 'a message that itself quotes a location',
      output: "lib/a.test.ts(1,1): error TS2300: Duplicate of 'lib/b.ts(2,2): error TS1: z'.",
      expected: { 'apps/sim/lib/a.test.ts': { TS2300: 1 } },
    },
  ])('$name', ({ output, expected }) => {
    expect(counts(output)).toEqual(expected)
  })

  it.each([
    ['a global diagnostic with no file', "error TS5083: Cannot read file '/repo/tsconfig.json'."],
    ['a compiler crash', 'panic: runtime error: invalid memory address'],
    ['a location whose category is not error', 'lib/a.test.ts(1,1): warning TS1: x'],
  ])('leaves %s unplaced instead of counting it as zero errors', (_name, line) => {
    const parsed = parseCompilerOutput(`lib/a.test.ts(1,1): error TS1: x\n${line}`, APP, ROOT)
    expect(parsed.unplaced).toEqual([line])
    expect(countErrors(parsed.errors)).toEqual({ 'apps/sim/lib/a.test.ts': { TS1: 1 } })
  })

  it.each([
    ['Found 2 errors in 1 file.', 2],
    ['Found 1 error in lib/a.test.ts:1', 1],
  ])('reads the summary %j as the compiler’s total', (line, total) => {
    expect(parseCompilerOutput(line, APP, ROOT)).toMatchObject({
      reportedTotal: total,
      unplaced: [],
    })
  })
})

describe('parseCounts', () => {
  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a flat per-file count', '{"a.test.ts": 3}'],
    ['a file with no codes', '{"a.test.ts": {}}'],
    ['a key that is not a TS code', '{"a.test.ts": {"2322": 1}}'],
    ['a zero count', '{"a.test.ts": {"TS2322": 0}}'],
    ['a negative count', '{"a.test.ts": {"TS2322": -1}}'],
    ['a fractional count', '{"a.test.ts": {"TS2322": 1.5}}'],
    ['a string count', '{"a.test.ts": {"TS2322": "3"}}'],
  ])('rejects %s', (_name, json) => {
    expect(() => parseCounts(json, 'baseline')).toThrow(/baseline/)
  })

  it('accepts per-file, per-code positive integer counts', () => {
    expect(parseCounts('{"a.test.ts": {"TS2322": 3}}', 'baseline')).toEqual({
      'a.test.ts': { TS2322: 3 },
    })
  })
})

describe('compareCounts', () => {
  it.each([
    {
      name: 'a new file with errors regresses from zero',
      current: { 'a.test.ts': { TS2322: 1 } },
      baseline: {},
      regressed: [{ file: 'a.test.ts', code: 'TS2322', count: 1, baseline: 0 }],
      shrunk: [],
    },
    {
      name: 'a rising count regresses',
      current: { 'a.test.ts': { TS2322: 4 } },
      baseline: { 'a.test.ts': { TS2322: 3 } },
      regressed: [{ file: 'a.test.ts', code: 'TS2322', count: 4, baseline: 3 }],
      shrunk: [],
    },
    {
      name: 'an equal count passes',
      current: { 'a.test.ts': { TS2322: 3 } },
      baseline: { 'a.test.ts': { TS2322: 3 } },
      regressed: [],
      shrunk: [],
    },
    {
      name: 'a falling count is stale',
      current: { 'a.test.ts': { TS2322: 2 } },
      baseline: { 'a.test.ts': { TS2322: 3 } },
      regressed: [],
      shrunk: [{ file: 'a.test.ts', code: 'TS2322', count: 2, baseline: 3 }],
    },
    {
      name: 'a file with no errors left is stale',
      current: {},
      baseline: { 'a.test.ts': { TS2322: 3 } },
      regressed: [],
      shrunk: [{ file: 'a.test.ts', code: 'TS2322', count: 0, baseline: 3 }],
    },
    {
      name: 'a new code in a file whose total stays flat regresses',
      current: { 'a.test.ts': { TS2322: 2, TS2345: 1 } },
      baseline: { 'a.test.ts': { TS2322: 3 } },
      regressed: [{ file: 'a.test.ts', code: 'TS2345', count: 1, baseline: 0 }],
      shrunk: [{ file: 'a.test.ts', code: 'TS2322', count: 2, baseline: 3 }],
    },
    {
      name: 'a fix in one file does not pay for a new error in another',
      current: { 'a.test.ts': { TS2322: 2 }, 'b.test.ts': { TS2322: 1 } },
      baseline: { 'a.test.ts': { TS2322: 3 } },
      regressed: [{ file: 'b.test.ts', code: 'TS2322', count: 1, baseline: 0 }],
      shrunk: [{ file: 'a.test.ts', code: 'TS2322', count: 2, baseline: 3 }],
    },
  ])('$name', ({ current, baseline, regressed, shrunk }) => {
    expect(compareCounts(current, baseline)).toEqual({ regressed, shrunk })
  })
})

describe('shrinkBaseline', () => {
  it('keeps lowered counts and never raises or admits a file or code', () => {
    expect(
      shrinkBaseline(
        {
          'lower.test.ts': { TS1: 1 },
          'higher.test.ts': { TS1: 9 },
          'new.test.ts': { TS1: 2 },
          'same.test.ts': { TS1: 4, TS2: 1 },
        },
        {
          'lower.test.ts': { TS1: 3 },
          'higher.test.ts': { TS1: 5 },
          'gone.test.ts': { TS1: 7 },
          'same.test.ts': { TS1: 4 },
        }
      )
    ).toEqual({
      'higher.test.ts': { TS1: 5 },
      'lower.test.ts': { TS1: 1 },
      'same.test.ts': { TS1: 4 },
    })
  })
})

/**
 * Runs the real script on a saved compiler output. The fixture sits under the repository's
 * node_modules so the copied script resolves its `@sim/*` imports, and holds its own baseline.
 */
describe('check-test-types command', () => {
  const REPO = path.resolve(import.meta.dirname, '..')
  const BASELINE = {
    'apps/sim/lib/a.test.ts': { TS2322: 2 },
    'apps/sim/lib/b.test.ts': { TS2554: 1 },
  }
  const UNCHANGED = [
    'lib/a.test.ts(1,1): error TS2322: Type mismatch.',
    'lib/a.test.ts(2,1): error TS2322: Type mismatch.',
    'lib/b.test.ts(3,1): error TS2554: Expected 1 arguments, but got 0.',
  ]
  let fixture: string

  beforeEach(() => {
    fixture = mkdtempSync(path.join(REPO, 'node_modules/.test-types-'))
    mkdirSync(path.join(fixture, 'scripts'))
    for (const file of ['scripts/check-test-types.ts', 'scripts/local-bin.ts']) {
      copyFileSync(path.join(REPO, file), path.join(fixture, file))
    }
    writeFileSync(baselineFile(), `${JSON.stringify(BASELINE, null, 2)}\n`)
  })

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true })
  })

  function baselineFile() {
    return path.join(fixture, 'scripts/check-test-types.baseline.json')
  }

  /** Runs on `lines` with the status a finished compile of them would have recorded. */
  function run(lines: string[], ...args: string[]) {
    const errorCount = lines.filter((line) => line.includes(': error TS')).length
    return runWithStatus(lines, { exitCode: errorCount ? 2 : 0, errorCount }, ...args)
  }

  /** `status: null` leaves `status.json` out, as a compile that never finished would. */
  function runWithStatus(lines: string[], status: unknown, ...args: string[]) {
    const diagnostics = path.join(fixture, 'diagnostics.txt')
    writeFileSync(diagnostics, lines.length ? `${lines.join('\n')}\n` : '')
    if (status !== null) {
      writeFileSync(path.join(fixture, 'status.json'), JSON.stringify(status))
    }
    return spawnSync(
      'bun',
      [path.join(fixture, 'scripts/check-test-types.ts'), '--diagnostics', diagnostics, ...args],
      { cwd: fixture, encoding: 'utf8' }
    )
  }

  it('passes unchanged counts and reports them in the baseline’s shape', () => {
    const result = run(UNCHANGED, '--report', 'report')
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(path.join(fixture, 'report/counts.json'), 'utf8'))).toEqual(
      BASELINE
    )
  })

  it.each([
    {
      name: 'a rising count',
      lines: [...UNCHANGED, 'lib/a.test.ts(9,1): error TS2322: Another mismatch.'],
      listed: 'apps/sim/lib/a.test.ts TS2322: 3 (baseline 2)',
      printed: 'apps/sim/lib/a.test.ts:9:1 TS2322 Another mismatch.',
      unrelated: 'apps/sim/lib/b.test.ts:3:1',
    },
    {
      name: 'a new code that replaces a fixed error',
      lines: [UNCHANGED[0], UNCHANGED[2], 'lib/a.test.ts(9,1): error TS2345: Bad argument.'],
      listed: 'apps/sim/lib/a.test.ts TS2345: 1 (baseline 0)',
      printed: 'apps/sim/lib/a.test.ts:9:1 TS2345 Bad argument.',
      unrelated: 'apps/sim/lib/a.test.ts:1:1 TS2322',
    },
    {
      name: 'a new file',
      lines: [...UNCHANGED, 'lib/c.test.ts(1,1): error TS2304: Cannot find name.'],
      listed: 'apps/sim/lib/c.test.ts TS2304: 1 (baseline 0)',
      printed: 'apps/sim/lib/c.test.ts:1:1 TS2304 Cannot find name.',
      unrelated: 'apps/sim/lib/a.test.ts:1:1',
    },
  ])('fails on $name and prints only the new error', ({ lines, listed, printed, unrelated }) => {
    const result = run(lines)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gained type errors')
    expect(result.stderr).toContain(listed)
    expect(result.stderr).toContain(printed)
    expect(result.stderr).not.toContain(unrelated)
  })

  it('fails on a dropped count until the baseline is updated', () => {
    const result = run(UNCHANGED.slice(1))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('apps/sim/lib/a.test.ts TS2322: 1 (baseline 2)')
    expect(result.stderr).toContain('--update')
    expect(result.stderr).not.toContain('gained type errors')
  })

  it('refuses to raise the baseline on --update and leaves it untouched', () => {
    const before = readFileSync(baselineFile(), 'utf8')
    const result = run(
      [UNCHANGED[0], UNCHANGED[2], 'lib/a.test.ts(9,1): error TS2345: Bad argument.'],
      '--update'
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('refused to raise the baseline')
    expect(result.stderr).toContain('apps/sim/lib/a.test.ts TS2345: 1 (baseline 0)')
    expect(readFileSync(baselineFile(), 'utf8')).toBe(before)
  })

  it('shrinks the baseline on --update', () => {
    const result = run([UNCHANGED[0]], '--update')
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(baselineFile(), 'utf8'))).toEqual({
      'apps/sim/lib/a.test.ts': { TS2322: 1 },
    })
  })

  it.each([
    ['a global diagnostic', "error TS5083: Cannot read file 'tsconfig.json'."],
    ['a crash', 'panic: runtime error'],
  ])('fails on %s without writing counts or touching the baseline', (_name, line) => {
    const before = readFileSync(baselineFile(), 'utf8')
    const result = run([...UNCHANGED, line], '--update', '--report', 'report')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not a located error')
    expect(result.stderr).toContain(line)
    expect(existsSync(path.join(fixture, 'report/counts.json'))).toBe(false)
    expect(readFileSync(baselineFile(), 'utf8')).toBe(before)
  })

  it.each([
    {
      name: 'empty diagnostics with no recorded status',
      lines: [],
      status: null,
      message: 'status.json is missing',
    },
    {
      name: 'empty diagnostics from a compile that exited with errors',
      lines: [],
      status: { exitCode: 2, errorCount: 3 },
      message: 'tsc exited with 2 but 0 errors were parsed',
    },
    {
      name: 'errors from a compile that exited clean',
      lines: UNCHANGED,
      status: { exitCode: 0, errorCount: 3 },
      message: 'tsc exited with 0 but 3 errors were parsed',
    },
    {
      name: 'truncated diagnostics',
      lines: UNCHANGED.slice(1),
      status: { exitCode: 2, errorCount: 3 },
      message: 'holds 2 errors but its compile printed 3',
    },
    {
      name: 'a crashed compile’s exit code',
      lines: UNCHANGED,
      status: { exitCode: 134, errorCount: 3 },
      message: 'is not { "exitCode"',
    },
    {
      name: 'a status with no error count',
      lines: UNCHANGED,
      status: { exitCode: 2 },
      message: 'is not { "exitCode"',
    },
  ])('fails on $name and never updates the baseline', ({ lines, status, message }) => {
    const before = readFileSync(baselineFile(), 'utf8')
    const result = runWithStatus(lines, status, '--update')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(readFileSync(baselineFile(), 'utf8')).toBe(before)
  })

  it('fails when the summary disagrees with the parsed errors', () => {
    const result = run([...UNCHANGED, 'Found 4 errors in 2 files.'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('tsc reported 4 errors but 3 were parsed')
  })
})
