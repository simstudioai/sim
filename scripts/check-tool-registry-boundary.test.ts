import { describe, expect, it } from 'vitest'
import {
  type Baseline,
  ratchetAgainstBaseline,
  ratchetFailed,
} from './check-tool-registry-boundary'

function baselineOf(entries: Record<string, number>): Baseline {
  return {
    generatedFrom: 'test',
    tolerance: { modules: 25, percent: 2 },
    entries: Object.fromEntries(
      Object.entries(entries).map(([entry, modules]) => [entry, { modules, gateways: {} }])
    ),
  }
}

describe('module-graph ratchet', () => {
  it('fails an entry with no recorded row, because nothing bounds its growth', () => {
    const verdict = ratchetAgainstBaseline(
      new Map([
        ['a/page.tsx', 100],
        ['b/route.ts', 1700],
      ]),
      baselineOf({ 'a/page.tsx': 100 })
    )

    expect(verdict.ratcheted).toEqual(['a/page.tsx'])
    expect(verdict.unbaselined).toEqual(['b/route.ts'])
    expect(ratchetFailed(verdict)).toBe(true)
  })

  it('allows growth inside the allowance and fails past it', () => {
    const within = ratchetAgainstBaseline(
      new Map([['a/page.tsx', 120]]),
      baselineOf({ 'a/page.tsx': 100 })
    )
    expect(within.regressed).toEqual([])
    expect(ratchetFailed(within)).toBe(false)

    const beyond = ratchetAgainstBaseline(
      new Map([['a/page.tsx', 200]]),
      baselineOf({ 'a/page.tsx': 100 })
    )
    expect(beyond.regressed).toEqual(['a/page.tsx'])
    expect(ratchetFailed(beyond)).toBe(true)
  })

  it('reports a shrink and a removed row without failing', () => {
    const verdict = ratchetAgainstBaseline(
      new Map([['a/page.tsx', 10]]),
      baselineOf({ 'a/page.tsx': 500, 'gone/page.tsx': 40 })
    )

    expect(verdict.shrunk).toEqual(['a/page.tsx'])
    expect(verdict.removed).toEqual(['gone/page.tsx'])
    expect(ratchetFailed(verdict)).toBe(false)
  })
})
