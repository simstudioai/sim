import {
  compareCounts,
  countErrors,
  parseCompilerOutput,
  parseCounts,
  shrinkBaseline,
} from '@scripts/check-test-types'
import { describe, expect, it } from 'vitest'

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
      expected: { 'apps/sim/app/(landing)/[slug]/page.test.tsx': 1 },
    },
    {
      name: 'a file outside the app resolves against where tsc ran',
      output: '../../packages/testing/src/mocks/db.ts(4,1): error TS2307: Cannot find module.',
      expected: { 'packages/testing/src/mocks/db.ts': 1 },
    },
    {
      name: 'an absolute path is made repo-relative',
      output: '/repo/apps/sim/lib/a.test.ts(1,1): error TS2345: Bad argument.',
      expected: { 'apps/sim/lib/a.test.ts': 1 },
    },
    {
      name: 'indented continuation lines belong to the error above',
      output: [
        "lib/a.test.ts(3,5): error TS2322: Type '{ a: 1 }' is not assignable to type 'B'.",
        "  Property 'b' is missing in type '{ a: 1 }' but required in type 'B'.",
        '    lib/b.ts(9,2): error TS2322: quoted inside a message chain',
        'lib/a.test.ts(8,1): error TS2554: Expected 1 arguments, but got 0.',
      ].join('\n'),
      expected: { 'apps/sim/lib/a.test.ts': 2 },
    },
    {
      name: 'CRLF output and blank lines',
      output: 'lib/a.test.ts(1,1): error TS1: x\r\n\r\nlib/b.test.ts(2,2): error TS2: y\r\n',
      expected: { 'apps/sim/lib/a.test.ts': 1, 'apps/sim/lib/b.test.ts': 1 },
    },
    {
      name: 'a message that itself quotes a location',
      output: "lib/a.test.ts(1,1): error TS2300: Duplicate of 'lib/b.ts(2,2): error TS1: z'.",
      expected: { 'apps/sim/lib/a.test.ts': 1 },
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
    expect(countErrors(parsed.errors)).toEqual({ 'apps/sim/lib/a.test.ts': 1 })
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
    ['a zero count', '{"a.test.ts": 0}'],
    ['a negative count', '{"a.test.ts": -1}'],
    ['a fractional count', '{"a.test.ts": 1.5}'],
    ['a string count', '{"a.test.ts": "3"}'],
  ])('rejects %s', (_name, json) => {
    expect(() => parseCounts(json, 'baseline')).toThrow(/baseline/)
  })

  it('accepts per-file positive integer counts', () => {
    expect(parseCounts('{"a.test.ts": 3}', 'baseline')).toEqual({ 'a.test.ts': 3 })
  })
})

describe('compareCounts', () => {
  it.each([
    {
      name: 'a new file with errors regresses from zero',
      current: { 'a.test.ts': 1 },
      baseline: {},
      regressed: [{ file: 'a.test.ts', count: 1, baseline: 0 }],
      shrunk: [],
    },
    {
      name: 'a rising count regresses',
      current: { 'a.test.ts': 4 },
      baseline: { 'a.test.ts': 3 },
      regressed: [{ file: 'a.test.ts', count: 4, baseline: 3 }],
      shrunk: [],
    },
    {
      name: 'an equal count passes',
      current: { 'a.test.ts': 3 },
      baseline: { 'a.test.ts': 3 },
      regressed: [],
      shrunk: [],
    },
    {
      name: 'a falling count is stale',
      current: { 'a.test.ts': 2 },
      baseline: { 'a.test.ts': 3 },
      regressed: [],
      shrunk: [{ file: 'a.test.ts', count: 2, baseline: 3 }],
    },
    {
      name: 'a file with no errors left is stale',
      current: {},
      baseline: { 'a.test.ts': 3 },
      regressed: [],
      shrunk: [{ file: 'a.test.ts', count: 0, baseline: 3 }],
    },
    {
      name: 'a fix in one file does not pay for a new error in another',
      current: { 'a.test.ts': 2, 'b.test.ts': 1 },
      baseline: { 'a.test.ts': 3 },
      regressed: [{ file: 'b.test.ts', count: 1, baseline: 0 }],
      shrunk: [{ file: 'a.test.ts', count: 2, baseline: 3 }],
    },
  ])('$name', ({ current, baseline, regressed, shrunk }) => {
    expect(compareCounts(current, baseline)).toEqual({ regressed, shrunk })
  })
})

describe('shrinkBaseline', () => {
  it('keeps lowered counts and never raises or admits a file', () => {
    expect(
      shrinkBaseline(
        { 'lower.test.ts': 1, 'higher.test.ts': 9, 'new.test.ts': 2, 'same.test.ts': 4 },
        { 'lower.test.ts': 3, 'higher.test.ts': 5, 'gone.test.ts': 7, 'same.test.ts': 4 }
      )
    ).toEqual({ 'higher.test.ts': 5, 'lower.test.ts': 1, 'same.test.ts': 4 })
  })
})
