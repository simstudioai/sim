import { describe, expect, it } from 'vitest'
import {
  type Baseline,
  discoverEntries,
  loadBaseline,
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

describe('guarded entries', () => {
  const entries = discoverEntries()

  /**
   * The headline win of the catalog projection was cutting the registry edge out
   * of this tool — ~6,756 modules down to ~1,321. It sat in no guarded subtree,
   * so nothing held it.
   */
  it('guards the Copilot block-metadata tool', () => {
    expect(entries).toContain('lib/mothership/tools/server/blocks/get-blocks-metadata-tool.ts')
  })

  it('guards every catalog projection module rather than a barrel over them', () => {
    expect(entries).toContain('lib/catalog/projection/block-detail.ts')
    expect(entries).toContain('lib/catalog/projection/tool.ts')
    expect(entries).not.toContain('lib/catalog/projection/index.ts')
  })

  it('has a recorded baseline row for every entry it discovers', () => {
    const baseline = loadBaseline()
    expect(baseline).not.toBeNull()
    const missing = entries.filter((entry) => !(baseline as Baseline).entries[entry])
    expect(missing).toEqual([])
  })
})
