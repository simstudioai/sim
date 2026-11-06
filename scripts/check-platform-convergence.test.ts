import { describe, expect, it } from 'vitest'
import { evaluateConvergence, findSharedPaths } from './check-platform-convergence'

describe('findSharedPaths', () => {
  it('pairs a file only when both trees hold the same path under app or lib', () => {
    expect(
      findSharedPaths(
        ['lib/data/home.ts', 'lib/data/zone-only.ts', 'app/(shell)/page.tsx'],
        ['lib/data/home.ts', 'lib/data/embedded-only.ts', 'app/page.tsx']
      )
    ).toEqual(['lib/data/home.ts'])
  })
})

describe('evaluateConvergence', () => {
  const baseline = { embeddedFiles: 3, sharedPaths: ['lib/a.ts', 'lib/b.ts'] }

  it('passes when the trees match the baseline', () => {
    expect(
      evaluateConvergence({ embeddedFiles: 3, sharedPaths: ['lib/a.ts', 'lib/b.ts'] }, baseline)
    ).toEqual({ grew: [], stale: [] })
  })

  it('fails a new file in the organization tree', () => {
    const result = evaluateConvergence(
      { embeddedFiles: 4, sharedPaths: baseline.sharedPaths },
      baseline
    )
    expect(result.grew).toHaveLength(1)
    expect(result.grew[0]).toContain('4')
  })

  it('fails a new path both trees hold', () => {
    const result = evaluateConvergence(
      { embeddedFiles: 3, sharedPaths: ['lib/a.ts', 'lib/b.ts', 'lib/c.ts'] },
      baseline
    )
    expect(result.grew).toEqual([expect.stringContaining('lib/c.ts')])
  })

  it('asks for a shrink when a path or file went away, so the baseline cannot drift above reality', () => {
    const result = evaluateConvergence({ embeddedFiles: 2, sharedPaths: ['lib/a.ts'] }, baseline)
    expect(result.grew).toEqual([])
    expect(result.stale).toHaveLength(2)
  })
})
