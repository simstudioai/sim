import { describe, expect, it } from 'vitest'
import { findPairingViolations, findRegeneratingTests, listGenerators } from './generators'

describe('findPairingViolations', () => {
  it('accepts a generator whose audit runs it with --check', () => {
    expect(
      findPairingViolations({
        'generate:docs': 'bun run scripts/generate-docs.ts',
        'check:docs': 'bun run scripts/generate-docs.ts --check',
      })
    ).toEqual([])
  })

  it('flags a generator with no audit', () => {
    expect(findPairingViolations({ 'generate:docs': 'bun run scripts/generate-docs.ts' })).toEqual([
      expect.stringContaining('`generate:docs` has no `check:docs`'),
    ])
  })

  it('flags a check-mode generator that nothing regenerates', () => {
    expect(
      findPairingViolations({ 'check:docs': 'bun run scripts/generate-docs.ts --check' })
    ).toEqual([
      expect.stringContaining('Add `"generate:docs": "bun run scripts/generate-docs.ts"`'),
    ])
  })

  it('accepts a standalone check-* audit that takes --check', () => {
    expect(
      findPairingViolations({
        'check:client-boundary': 'bun run scripts/check-client-boundary-imports.ts --check',
      })
    ).toEqual([])
  })

  it('accepts an aliased generator and flags its audit when the alias is missing', () => {
    const audit = { 'check:skills': 'bun run scripts/sync-skills.ts --check' }
    expect(
      findPairingViolations({ ...audit, 'skills:sync': 'bun run scripts/sync-skills.ts' })
    ).toEqual([])
    expect(findPairingViolations(audit)).toHaveLength(1)
  })
})

describe('listGenerators', () => {
  it('lists paired and aliased generators in package.json order and skips unpaired ones', () => {
    expect(
      listGenerators({
        'skills:sync': 'bun run scripts/sync-skills.ts',
        'generate:a': 'bun run a.ts',
        'check:a': 'bun run a.ts --check',
        'generate:pi-model-catalog': 'bun run b.ts',
        'check:skills': 'bun run scripts/sync-skills.ts --check',
      })
    ).toEqual(['skills:sync', 'generate:a'])
  })
})

describe('findRegeneratingTests', () => {
  it('flags a test that rewrites an artifact behind an UPDATE_ flag and ignores non-tests', () => {
    const flag = 'UPDATE_SDK_FIXTURE_CATALOG'
    const content = `if (process.env.${flag} === '1') writeFileSync(p, text)`
    expect(
      findRegeneratingTests([
        { path: 'apps/sim/lib/catalog.test.ts', content },
        { path: 'scripts/generate-x.ts', content },
      ])
    ).toEqual([expect.stringContaining('apps/sim/lib/catalog.test.ts regenerates')])
  })
})
